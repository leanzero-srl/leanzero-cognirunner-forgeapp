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

/* ===== 1.5 commit 1 — the Virtual Administrator's two new shared modules ===== */
// Both are named EXPLICITLY here (the loop above discovers them, but a named check says
// which contracts must exist, so deleting an export fails with a sentence rather than
// with "exports at least one binding").
const vaConfig = await import(pathToFileURL(path.join(sharedDir, "va-config.js")).href);
const voiceLint = await import(pathToFileURL(path.join(sharedDir, "voice-lint.js")).href);
const voiceData = await import(pathToFileURL(path.join(sharedDir, "voice-rules-data.js")).href);
const vaConfigSrc = readFileSync(path.join(sharedDir, "va-config.js"), "utf8");
const voiceLintSrc = readFileSync(path.join(sharedDir, "voice-lint.js"), "utf8");

for (const name of ["normalizeVa", "renderGuardrailSentences", "vaWriteScope", "VA_DEFAULTS", "VA_LIMITS", "VA_CEILINGS"]) {
  ok(typeof vaConfig[name] !== "undefined", `va-config.js exports ${name}`);
}
// 1.5 commit 2's ledger and key builders clamp against these member names. They are
// asserted here as well as in va-config.test.mjs because the two commits land from two
// worktrees, and a rename that only fails in the other one's suite fails at MERGE.
for (const name of ["itemTtlDays", "tickTtlDays", "effectTtlDays", "itemRowCap", "attemptsCap",
  "memoryCompactBytes", "memoryCapBytes", "stagedBodyMaxChars", "constraintsMax", "constraintMaxChars",
  "maxItemsPerTick", "capsPerHour", "capsPerDay", "owedPerHour", "minPostGapMinutes",
  "antiPileUpDays", "otherWriterQuietMinutes", "shadowTicks", "historyMax", "notesMaxChars"]) {
  ok(typeof vaConfig.VA_LIMITS[name] === "number", `VA_LIMITS.${name} is a flat number (the ledger clamps against it)`);
}
ok(typeof voiceLint.lintVoice === "function", "voice-lint.js exports lintVoice");
ok(typeof voiceData.VOICE_RULES_TABLES === "object", "voice-rules-data.js exports VOICE_RULES_TABLES");

// ONE HOME FOR THE VA BRAKE NUMBERS. Every number a runtime gate enforces is declared in
// registry-limits.js beside the job/agent brakes and its refusal sentence; va-config.js
// composes them into VA_LIMITS. A literal RETYPED in va-config.js is the two-homes defect
// this repo is named after, and it would be invisible: the wizard would keep rendering the
// cap it was given while the engine held another one.
const VA_BRAKE_NUMBERS = [
  "VA_CAPS_PER_HOUR_DEFAULT", "VA_CAPS_PER_HOUR_MAX", "VA_CAPS_PER_DAY_DEFAULT", "VA_CAPS_PER_DAY_MAX",
  "VA_OWED_PER_HOUR_DEFAULT", "VA_OWED_PER_HOUR_MAX", "VA_MAX_ITEMS_PER_TICK_DEFAULT", "VA_MAX_ITEMS_PER_TICK_MAX",
  "VA_MAX_CANDIDATES_PER_TICK", "VA_SHADOW_TICKS_DEFAULT", "VA_SHADOW_TICKS_MAX",
  "VA_MIN_POST_GAP_MINUTES_DEFAULT", "VA_MIN_POST_GAP_MINUTES_MIN", "VA_MIN_POST_GAP_MINUTES_MAX",
  "VA_ANTI_PILE_UP_DAYS_DEFAULT", "VA_ANTI_PILE_UP_DAYS_MAX",
  "VA_OTHER_WRITER_QUIET_MINUTES_DEFAULT", "VA_OTHER_WRITER_QUIET_MINUTES_MAX",
  "VA_ITEM_ATTEMPTS_MAX", "VA_ITEM_ROW_CAP", "VA_ITEM_TTL_DAYS", "VA_TICK_TTL_DAYS", "VA_EFFECT_TTL_DAYS",
  "VA_HISTORY_MAX", "VA_NOTES_MAX_CHARS", "VA_STAGED_BODY_MAX_CHARS",
  "VA_CONSTRAINTS_MAX", "VA_CONSTRAINT_MAX_CHARS",
  "VA_MEMORY_COMPACT_BYTES", "VA_MEMORY_MAX_BYTES", "VA_HEALTH_BANNER_FAILED_TICKS",
];
for (const name of VA_BRAKE_NUMBERS) {
  ok(new RegExp(`export const ${name}\\s*=\\s*\\d`).test(limitsSrc), `registry-limits.js declares ${name}`);
  ok(!new RegExp(`(const|let|var)\\s+${name}\\s*=`).test(vaConfigSrc), `va-config.js does NOT re-declare ${name}`);
}
ok(/from\s+"\.\/registry-limits\.js"/.test(vaConfigSrc), "va-config.js imports its brake numbers from registry-limits.js");
ok(typeof limits.vaRefusalText === "function"
  && limits.vaRefusalText("caps-hour", 6) !== limits.vaRefusalText("caps-owed", 12)
  && limits.vaRefusalText("attempts", 3).includes("3"),
  "the VA brake refusal sentences live beside the numbers and interpolate them");
// The record's SHAPE bounds are the other half of the split and belong in va-config.js.
ok(/export const VA_PERSONA_NAME_MAX/.test(vaConfigSrc) && !/VA_PERSONA_NAME_MAX/.test(limitsSrc),
  "the record's shape bounds live in va-config.js, not in registry-limits.js");

// ONE HOME FOR THE VOICE WORDS (F-420). voice-lint.js owns the RULES; the banned openers,
// method leaks, sign-offs and disclaimers are DATA in voice-rules-data.js and arrive as an
// argument, so the `voice-rules` knowledge pack can replace the source in 14b without
// touching the linter, the post gate or the wizard.
ok(/from\s+"\.\/voice-rules-data\.js"/.test(voiceLintSrc), "voice-lint.js reads its tables from the data module");
ok(/tables\s*=\s*VOICE_RULES_TABLES/.test(voiceLintSrc), "…and takes them as an argument, so the home can move");
for (const phrase of ["great question", "as an ai", "best regards", "i ran a query"]) {
  ok(!voiceLintSrc.toLowerCase().includes(phrase), `voice-lint.js does not hardcode the phrase "${phrase}"`);
}
ok(voiceData.BANNED_OPENERS.length > 0 && voiceData.METHOD_LEAKS.length > 0
  && voiceData.SIGN_OFFS.length > 0 && voiceData.AI_DISCLAIMERS.length > 0,
  "every voice table has entries");
ok(/voice-rules/.test(voiceLintSrc) && /voice-rules/.test(readFileSync(path.join(sharedDir, "voice-rules-data.js"), "utf8")),
  "both modules say, in their headers, that the voice-rules pack replaces this home in 14b");
// The lint result must not carry the text it judged — asserted in full in
// voice-lint.test.mjs; asserted here too because it is a security property of a module
// whose output reaches logs, receipts and the next turn's prompt.
{
  const r = voiceLint.lintVoice("Certainly! The widget frobnicator was reconfigured.", { register: "plain", maxSentences: 3 });
  ok(r.ok === false && !JSON.stringify(r).includes("frobnicator"), "the lint result never echoes the text it judged");
}

console.log(`\nshared-imports: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
