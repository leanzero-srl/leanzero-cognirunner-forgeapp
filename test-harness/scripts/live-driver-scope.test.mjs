/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-711, F-712, F-713 - CAN THE DRIVER EVEN BE LOADED?
 *
 * The F-699 conversion rewrote the environment plumbing of ~40 live drivers and shipped
 * EIGHT of them with an undeclared identifier at module scope: six coder drivers called
 * requireEnvAck with no import (F-711), and the two fault-arming UI drivers used
 * ENV_ID_DEFAULT without ever destructuring it out of the guard's result (F-712). Every
 * one of them dies with a ReferenceError on the first line of module evaluation - before
 * loadEnv, before any hook call, with no evidence file and an exit code an operator
 * cannot tell apart from a missing .env.
 */

/*
 * Nothing caught it, and that is F-713:
 *   - node --check exits 0 on all eight. It is a PARSER; an undeclared identifier is a
 *     runtime error, not a syntax error, and node --check never resolves a name.
 *   - evidence-redaction.test.mjs's directory rules read every driver as TEXT - rule 4e
 *     asserts a fault-arming driver CALLS requireEnvAck, which all six coder files did.
 *     Calling it was never the problem.
 *   - a dynamic import of a driver is NOT available to us: these files self-execute at
 *     module scope - importing one arms faults, opens browsers and writes to a tenant.
 *   - an AST scope pass would be the complete answer, and acorn is not a dependency of
 *     this harness (it exists only as a transitive package under the repo root's
 *     installed packages, which the harness must not reach into).
 *
 * So this is a SCOPE check built out of the two things that are always true of this
 * directory, and it is deliberately narrow so that it is never wrong:
 *
 *   RULE 1 (F-711). Every name that lib/shared-env-guard.mjs EXPORTS - the list is
 *   parsed from the library, so it cannot drift - that a driver USES must appear in that
 *   driver's own import clause from the guard, or be declared in the file itself.
 *
 *   RULE 2 (F-712). Every SCREAMING_SNAKE identifier a driver uses must be BOUND
 *   somewhere in that driver: an import clause, a const/let/var, an object or array
 *   destructuring pattern (which is how a guard result is taken apart), a function, or a
 *   class. Module-scope constants in this directory are SCREAMING_SNAKE by universal
 *   convention, so an unbound one is always the F-712 defect and never a false positive
 *   from an inner scope.
 *
 *   RULE 2b (F-729, F-749). The guard's OWN RESULT FIELDS - EVERY field `requireEnvAck`
 *   returns, parsed out of its RETURN LITERAL and not out of the docblock example that
 *   destructures three of them (F-749) - are policed WHATEVER their case.
 *   RULE 2 is a convention test and these names are lowercase BY CONTRACT, so they were the
 *   one family convention could not reach: a driver that copies the docblock's own
 *   `const { envName, hookUrl, envId } = requireEnvAck(...)` and drops a field dies at module
 *   evaluation, and both gates used to answer "clean" on it, measured.
 *
 * THIS FILE IS THE ONE HOME (F-728). `evidence-redaction.test.mjs` carried a second copy of
 * RULES 1 and 2 as its section 4f-2, and that copy RETYPED the guard's export list while its
 * own docblock promised the vocabulary was never hand-listed - so adding an export to the
 * guard turned one rule red and left the other green, about the same file. The copy is gone
 * and that file points here. Do not write a third.
 *
 * Both rules run over source with comments and string and template literals stripped, so
 * a name that only appears inside prose or a URL is not a use.
 *
 * The positive controls at the bottom are the two REAL breakages, verbatim, so a future
 * simplification of either predicate goes red instead of quiet.
 *
 * Run: node scripts/live-driver-scope.test.mjs (auto-discovered by run-offline.mjs)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maskNonCode } from "../lib/js-source-scan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.join(here, "..", "lib");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/* Comments and string/template literals are not code. The answer lives in
 * `lib/js-source-scan.mjs` (F-730), because `evidence-redaction.test.mjs` needed the same
 * question answered and had grown its OWN, weaker version — comments only — and then walked
 * parentheses over the result, so a `)` in a FAIL message truncated a call's arguments. Two
 * suites, one question, two answers is the exact defect these rules police. The library
 * MASKS to spaces of the same length, which is what lets that file slice the original by the
 * indices it balanced on; here, only the identifier scan reads it, and a mask reads
 * identically to a strip. The `regexCanStart` heuristic moved WITH it, verbatim, because it
 * was paid for in this suite's first-run false positives.
 *
 * Re-exported under its old name so the rest of this file, and anything that imported it,
 * still reads the same. */
export const stripNonCode = maskNonCode;

/** Identifiers actually READ: not a `.prop`, not an object-literal key or label `prop:`. */
export function usedIdentifiers(code) {
  const used = new Set();
  /* LOOKBEHIND, not a consuming group: a leading `[^\w$.]` would eat the separator and
     make the NEXT identifier unmatchable, so `const ENV_ID` reported only `const`. That
     silently halved this scan on its first draft - `${AAA}/x/${BBB}` lost BBB. */
  const re = /(?<![\w$.])([A-Za-z_$][\w$]*)[ \t]*(:?)/g;
  let m;
  while ((m = re.exec(code))) {
    const name = m[1];
    /* `foo:` is a key, a label, or the LEFT side of a destructuring rename - none of
       which is a read, and skipping it is what makes RULE 2 quiet on `{ envId: X }`. */
    if (m[2] === ":" && code[re.lastIndex] !== ":") continue;
    used.add(name);
  }
  return used;
}

/** Every name this file BINDS: imports, declarations and destructuring patterns. */
export function boundIdentifiers(code) {
  const bound = new Set();
  const add = (n) => { if (n) bound.add(n); };

  /* import clauses: default, namespace and named, with `as` renames */
  for (const m of code.matchAll(/\bimport\s+([\s\S]*?)\s+from\s*[^;\n]*/g)) {
    for (const n of m[1].matchAll(/([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/g)) {
      add(n[2] || n[1]);
    }
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);

  /* destructuring patterns. The LOCAL binding is the name AFTER a colon when there is
     one, and the bare name otherwise - which is exactly the F-712 shape. */
  for (const m of code.matchAll(/(?:const|let|var)\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*=/g)) {
    const pat = m[1];
    for (const p of pat.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/g)) add(p[2]);
    const keys = new Set([...pat.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((x) => x[1]));
    for (const p of pat.matchAll(/([A-Za-z_$][\w$]*)/g)) if (!keys.has(p[1])) add(p[1]);
  }

  /* parameters - never SCREAMING_SNAKE in this directory, but cheap insurance */
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const p of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) add(p[1]);
  }
  for (const m of code.matchAll(/\bfunction\s*\*?\s*[\w$]*\s*\(([^()]*)\)/g)) {
    for (const p of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) add(p[1]);
  }
  for (const m of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  return bound;
}

/** SCREAMING_SNAKE globals a driver may legitimately read without declaring one. */
const SCREAMING_GLOBALS = new Set([
  "URL", "JSON", "NaN", "Infinity", "AbortSignal", "AbortController", "EOL",
  "TextEncoder", "TextDecoder", "Buffer", "URLSearchParams", "WeakMap", "WeakSet",
]);
const isScreaming = (n) => /^[A-Z][A-Z0-9_]*$/.test(n) && n.length >= 2;

/* The guard's export list, parsed FROM the library so this test cannot drift from it. */
const guardSrc = fs.readFileSync(path.join(libDir, "shared-env-guard.mjs"), "utf8");
const GUARD_EXPORTS = new Set();
for (const m of guardSrc.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) GUARD_EXPORTS.add(m[1]);
for (const m of guardSrc.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) GUARD_EXPORTS.add(m[1]);
for (const m of guardSrc.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
  for (const n of m[1].split(",")) {
    const name = n.trim().split(/\s+as\s+/).pop().trim();
    if (name) GUARD_EXPORTS.add(name);
  }
}
ok(GUARD_EXPORTS.has("requireEnvAck") && GUARD_EXPORTS.has("forgeEnvId"),
  "the guard's export list parsed from the library (got: " + [...GUARD_EXPORTS].join(", ") + ")");

/* ── RULE 2b (F-729) · THE GUARD'S OWN RESULT FIELDS, WHATEVER THEIR CASE ──────────
 *
 * RULE 2 judges SCREAMING_SNAKE by convention, and 4f-2 in `evidence-redaction.test.mjs`
 * derived its vocabulary from what drivers ALREADY BIND — so neither could ever see the
 * lowercase form, because not one driver binds a bare lowercase name today. MEASURED before
 * this rule:
 *
 *   scopeViolations('import { requireEnvAck } from "../lib/shared-env-guard.mjs";\n' +
 *                   'const { envName: ENV_NAME } = requireEnvAck(…);\n' +
 *                   'const res = await fetch(hookUrl, …)')
 *   → { missingGuardImport: [], unbound: [] }
 *
 * That source is ONE COPY-PASTE from the guard's own CONTRACT docblock —
 * `const { envName, hookUrl, envId } = requireEnvAck(…)` — with one field dropped, which is
 * the F-712 edit in the shape the library TELLS authors to write. The driver dies at module
 * evaluation with no evidence file, and `npm run test:offline` calls the directory sound.
 *
 * The policed names are PARSED OUT OF THE LIBRARY, never listed here: the contract the
 * library publishes is the contract this rule holds authors to, and a field added to the
 * guard's result is policed the day it is added.
 *
 * F-749 — AND THE SOURCE IS THE RETURN LITERAL, NOT THE DOCBLOCK EXAMPLE. The first draft
 * parsed `const { envName, hookUrl, envId } = requireEnvAck(` out of the CONTRACT docblock,
 * so RULE 2b policed the three fields that one EXAMPLE happens to destructure while
 * `urlVar`, `shared` and `acknowledged` — returned by the same function, listed in the same
 * `@returns` row — stayed invisible. F-729's exact defect survived for half of its own
 * return. MEASURED on the shape the library itself tells authors to write, one field renamed
 * and three read bare:
 *
 *   scopeViolations('import { requireEnvAck } from "../lib/shared-env-guard.mjs";\n' +
 *                   'const { envName: ENV_NAME } = requireEnvAck(argv, {…});\n' +
 *                   'if (shared && !acknowledged) console.log(urlVar);')
 *   → { missingGuardImport: [], unbound: [] }   ← both gates green, ReferenceError at load
 *
 * The check then runs the OTHER way too: the docblock's example must be a SUBSET of what the
 * function really returns, so the published contract cannot quietly drift from the code it
 * describes. A docblock→return check alone can only ever police what the example mentions,
 * which is how the gap got in. */
const GUARD_RESULT_FIELDS = (() => {
  const ret = guardSrc.match(/\breturn\s*\{([^}]*)\}\s*;/g) || [];
  /* `requireEnvAck`'s return is the one that opens with `envName`. Keys only — the literal
     is `{ envName, hookUrl, envId: row.forgeEnvId, … }` and `row` is not a result field. */
  const mine = ret.find((r) => /\{\s*envName\b/.test(r));
  if (!mine) return [];
  return mine.replace(/^\breturn\s*\{|\}\s*;$/g, "").split(",")
    .map((part) => (part.match(/^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/) || [])[1])
    .filter(Boolean);
})();
ok(GUARD_RESULT_FIELDS.length >= 6
  && ["envName", "hookUrl", "envId", "urlVar", "shared", "acknowledged"].every((f) => GUARD_RESULT_FIELDS.includes(f)),
  "F-749: the policed vocabulary is READ from requireEnvAck's RETURN LITERAL — every field it hands back, not the three its docblock example destructures (got: " + GUARD_RESULT_FIELDS.join(", ") + ")");
{
  /* …and the docblock describes the function. A `@returns` row or a docblock is prose until
     something checks it against the code, and prose that is wrong reads authoritative.
     Direction matters: the EXAMPLE must be a subset of the RETURN, never the reverse — an
     example is allowed to be short, but it may not name a field that does not exist. */
  const m = guardSrc.match(/const\s*\{([^}]*)\}\s*=\s*requireEnvAck\s*\(/);
  ok(!!m, "the CONTRACT docblock's example destructuring is readable from here");
  const documented = m ? [...m[1].matchAll(/([A-Za-z_$][\w$]*)/g)].map((x) => x[1]) : [];
  ok(documented.length >= 3, "…and names at least the three fields every driver needs (got: " + documented.join(", ") + ")");
  for (const f of documented) {
    ok(GUARD_RESULT_FIELDS.includes(f),
      `F-729/F-749: the CONTRACT docblock destructures \`${f}\`, and requireEnvAck really returns it — the documented shape is a subset of the real one`);
  }
}

export function scopeViolations(src) {
  const code = stripNonCode(src);
  const used = usedIdentifiers(code);
  const bound = boundIdentifiers(code);
  const imported = new Set(
    [...code.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*[^;\n]*shared-env-guard\.mjs/g)]
      .flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop().trim()))
      .filter(Boolean),
  );
  const missingGuardImport = [];
  const unbound = [];
  for (const name of used) {
    if (GUARD_EXPORTS.has(name) && !imported.has(name) && !bound.has(name)) missingGuardImport.push(name);
    if (isScreaming(name) && !SCREAMING_GLOBALS.has(name) && !bound.has(name)) unbound.push(name);
    /* RULE 2b (F-729) — the guard's own result-field names are policed WHATEVER their case.
       `isScreaming` is a convention test and these names are lowercase by contract, so this
       is the one family that convention cannot reach. A name the file BINDS — for any
       reason, including as a function parameter — is not reported, exactly as above. */
    if (!isScreaming(name) && GUARD_RESULT_FIELDS.includes(name) && !bound.has(name)) unbound.push(name);
  }
  return { missingGuardImport: missingGuardImport.sort(), unbound: [...new Set(unbound)].sort() };
}

/* THE COHORT. Every live driver, plus the `_probe-*` scripts that open an admin page:
 * F-715 put them on the same environment rule, so they are on the same scope rule. */
const drivers = fs.readdirSync(here)
  .filter((f) => f.endsWith("-live.mjs") || f.startsWith("_probe-"))
  .sort();
ok(drivers.length > 30, "the live-driver cohort is non-trivial (" + drivers.length + " files)");

for (const f of drivers) {
  const v = scopeViolations(fs.readFileSync(path.join(here, f), "utf8"));
  ok(v.missingGuardImport.length === 0,
    "RULE 1 (F-711) " + f + ": uses shared-env-guard export(s) it never imports: " + v.missingGuardImport.join(", "));
  ok(v.unbound.length === 0,
    "RULE 2 (F-712) " + f + ": uses SCREAMING_SNAKE name(s) nothing in the file binds: " + v.unbound.join(", "));
}

/* RULE 3 (F-715) HAS MOVED. It lived here only because `evidence-redaction.test.mjs` was
 * held by another hand the day it was written, and its own comment said so: "it belongs in
 * 4f and should be folded there". F-718 folded it. The env-id cohort - every `lib/*.mjs`
 * and every `scripts/*.mjs`, minus the guard, the compiler fixture and the rule's own home
 * - is now section 4f-1 of `scripts/evidence-redaction.test.mjs`, with the same two
 * positive controls. Do not re-add it here: a rule about second homes is the last rule that
 * should have two. This file is about whether a driver's module scope CLOSES. */

/* POSITIVE CONTROLS - the two real breakages, verbatim, plus their fixed twins. */
{
  const f711 = [
    'import fs from "node:fs";',
    'import { loadEnv } from "../lib/env.mjs";',
    'const { hookUrl: URL_ } = requireEnvAck(process.argv.slice(2), { faults: [], defaultEnv: "staging" });',
    "const ENV = loadEnv();",
  ].join("\n");
  ok(scopeViolations(f711).missingGuardImport.includes("requireEnvAck"),
    "POSITIVE CONTROL (F-711): a driver that CALLS requireEnvAck with no guard import is caught");

  const f711fixed = f711.replace('import { loadEnv } from "../lib/env.mjs";',
    'import { loadEnv } from "../lib/env.mjs";\nimport { requireEnvAck } from "../lib/shared-env-guard.mjs";');
  ok(scopeViolations(f711fixed).missingGuardImport.length === 0,
    "NEGATIVE CONTROL (F-711): the same source with the import present is clean");

  const f712 = [
    'import { requireEnvAck } from "../lib/shared-env-guard.mjs";',
    "const { envName: ENV_NAME, hookUrl: HOOK_URL } = requireEnvAck(process.argv.slice(2), {",
    '  faults: ["jiraUserSearch"],',
    "  maxSeconds: 240,",
    "});",
    'const ENV_ID = arg("envid", ENV_ID_DEFAULT);',
  ].join("\n");
  const v712 = scopeViolations(f712);
  ok(v712.unbound.includes("ENV_ID_DEFAULT"),
    "POSITIVE CONTROL (F-712): ENV_ID_DEFAULT used but never destructured out of requireEnvAck is caught");
  ok(!v712.unbound.includes("ENV_NAME") && !v712.unbound.includes("HOOK_URL") && !v712.unbound.includes("ENV_ID"),
    "...and the names the SAME destructuring does bind are not reported");

  const v712fixed = scopeViolations(f712.replace("hookUrl: HOOK_URL }", "hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT }"));
  ok(v712fixed.unbound.length === 0,
    "NEGATIVE CONTROL (F-712): with envId destructured, the same source is clean");

  /* ── RULE 2b (F-729) — THE BREAKER'S MEASURED SHAPE, VERBATIM ──────────────────
     `{ envName: ENV_NAME }` plus a BARE `hookUrl`: one copy-paste from the guard's CONTRACT
     docblock with one field dropped. Both gates used to answer `{ missingGuardImport: [],
     unbound: [] }` on it, and the driver dies at module evaluation. */
  const f729 = [
    'import { requireEnvAck } from "../lib/shared-env-guard.mjs";',
    'const { envName: ENV_NAME } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: [] });',
    "const res = await fetch(hookUrl, { method: \"POST\" });",
  ].join("\n");
  const v729 = scopeViolations(f729);
  ok(v729.unbound.includes("hookUrl"),
    "POSITIVE CONTROL (F-729): the guard's LOWERCASE result field, used bare and never destructured, is caught — the measured pre-fix answer was an empty violation list");
  ok(!v729.unbound.includes("ENV_NAME"),
    "...and the name the SAME destructuring binds is still not reported");
  ok(scopeViolations(f729.replace("{ envName: ENV_NAME }", "{ envName: ENV_NAME, hookUrl }")).unbound.length === 0,
    "NEGATIVE CONTROL (F-729): with `hookUrl` destructured — the docblock's own form — the same source is CLEAN");
  ok(scopeViolations('const r = { envName: "dev" };\nconst u = row.hookUrl;\nconst v = "envId";').unbound.length === 0,
    "NEGATIVE CONTROL (F-729): an object KEY, a PROPERTY read and a STRING spelling a result field are none of them reads of a local");
  ok(scopeViolations('const pick = (envName, hookUrl) => envName + hookUrl;').unbound.length === 0,
    "NEGATIVE CONTROL (F-729): a parameter of the same name BINDS it — the rule reports an unbound use, not a forbidden word");
  ok(scopeViolations('import { hookUrlFor } from "../lib/shared-env-guard.mjs";\nconst u = hookUrlFor("dev");').unbound.length === 0,
    "NEGATIVE CONTROL (F-729): `hookUrlFor` is an EXPORT, not a result field — the two families do not bleed into each other");

  /* ── F-749 — THE HALF OF THE SAME RETURN THE DOCBLOCK EXAMPLE DOES NOT MENTION ────
     `urlVar`, `shared` and `acknowledged` are handed back by the same call, on the same
     line, and were unpoliced purely because the example above them destructures three
     fields and stops. This is the F-712 shape written against the OTHER half. */
  const f749 = [
    'import { requireEnvAck } from "../lib/shared-env-guard.mjs";',
    'const { envName: ENV_NAME } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: [] });',
    "if (shared && !acknowledged) console.log(urlVar);",
  ].join("\n");
  const v749 = scopeViolations(f749);
  for (const f of ["shared", "acknowledged", "urlVar"]) {
    ok(v749.unbound.includes(f),
      `POSITIVE CONTROL (F-749): the bare \`${f}\` is caught — a field requireEnvAck really returns, invisible to the rule while the vocabulary came from the docblock's three-field example (measured pre-fix: unbound: [])`);
  }
  ok(!v749.unbound.includes("ENV_NAME"),
    "...and the name the SAME destructuring binds is still not reported");
  ok(scopeViolations(f749.replace("{ envName: ENV_NAME }", "{ envName: ENV_NAME, shared, acknowledged, urlVar }")).unbound.length === 0,
    "NEGATIVE CONTROL (F-749): with all three destructured, the same source is CLEAN — the rule reports an unbound use, not a forbidden word");
  ok(scopeViolations('const row = { shared: true };\nconst a = row.shared;\nconst b = "acknowledged";\nconst c = e.urlVar;').unbound.length === 0,
    "NEGATIVE CONTROL (F-749): an object KEY, a PROPERTY read and a STRING spelling one of the three are none of them reads of a local — `shared` is a common enough word that this matters more here than for `hookUrl`");
}

/* The stripper itself, because both rules stand on it. */
{
  ok(!usedIdentifiers(stripNonCode('const a = "requireEnvAck";')).has("requireEnvAck"),
    "a name inside a STRING is not a use");
  ok(!usedIdentifiers(stripNonCode("/* requireEnvAck lives in the guard */")).has("requireEnvAck"),
    "a name inside a BLOCK COMMENT is not a use");
  ok(!usedIdentifiers(stripNonCode("// see requireEnvAck\n")).has("requireEnvAck"),
    "a name inside a LINE COMMENT is not a use");
  ok(usedIdentifiers(stripNonCode("const u = `${BASE}/jira`;")).has("BASE"),
    "a name inside a substitution HOLE of a template literal IS a use");
  ok(!usedIdentifiers(stripNonCode("const u = `https://SOMEHOST/jira`;")).has("SOMEHOST"),
    "...but the literal TEXT around the hole is not");
  ok(usedIdentifiers(stripNonCode("const u = `${AAA}/x/${BBB}`;")).has("BBB"),
    "a SECOND hole in the same template is still code");
  /* REGRESSION (this test's own first draft): a CONSUMING leading class ate the
     separator, so the identifier after any single space was never matched. */
  ok(usedIdentifiers("const ENV_ID = 1;").has("ENV_ID"),
    "an identifier immediately after another token is still matched (no consumed separator)");
  ok(!usedIdentifiers("const a = row.ENV_ID;").has("ENV_ID"),
    "...and a PROPERTY read is still not a use");
  /* a regex literal is a pattern, not three constants - the first-run false positives */
  ok(!usedIdentifiers(stripNonCode("const r = /WRITE BRAKE/.test(l);")).has("BRAKE"),
    "prose inside a REGEX LITERAL is not a use");
  ok(!usedIdentifiers(stripNonCode("const r = logs.filter((l) => /cache|DEFECT/i.test(l));")).has("DEFECT"),
    "...including an alternation with flags");
  ok(usedIdentifiers(stripNonCode("const r = A / B / C;")).has("C"),
    "...and a DIVISION is not read as a regex");
}

console.log("live-driver-scope.test.mjs: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
