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

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.join(here, "..", "lib");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/* Comments and string/template literals are not code. They are replaced with spaces
 * rather than deleted so line offsets stay honest for anyone debugging a hit. */
export function stripNonCode(input) {
  let src = input;
  let out = "";
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, " ");
  /* A `/` starts a REGEX LITERAL only where a value is expected. Every false positive in
     the first run of this test came from one: `/WRITE BRAKE/`, `/cache|DEFECT/i`,
     `/ROTATION NOT/` - prose inside a pattern, read as three module-scope constants. */
  const regexCanStart = () => {
    for (let k = out.length - 1; k >= 0; k--) {
      const ch = out[k];
      if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") continue;
      if ("(,=:[!&|?{};+-*%~^<>".includes(ch)) return true;
      if (/[\w$)\]]/.test(ch)) {
        /* `return /x/`, `typeof /x/` - a keyword, not a value */
        const tail = out.slice(Math.max(0, k - 12), k + 1);
        return /\b(return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/.test(tail);
      }
      return false;
    }
    return true;
  };
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (c === "/" && two !== "//" && two !== "/*" && regexCanStart()) {
      let j = i + 1, cls = false, closed = false;
      while (j < src.length) {
        const d = src[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;                 /* not a regex after all */
        if (d === "[") cls = true;
        else if (d === "]") cls = false;
        else if (d === "/" && !cls) { j++; closed = true; break; }
        j++;
      }
      if (closed) {
        while (j < src.length && /[dgimsuvy]/.test(src[j])) j++;
        out += blank(src.slice(i, j)); i = j; continue;
      }
    }
    if (two === "//") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop)); i = stop; continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop)); i = stop; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let hole = -1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (c === "`" && src[j] === "$" && src[j + 1] === "{") { hole = j; break; }
        j++;
      }
      if (hole !== -1) {
        /* A substitution hole in a template literal IS code - keep it, then re-enter the
         * rest of the template as if a fresh backtick started at the closing brace. */
        out += blank(src.slice(i, hole));
        let depth = 1, k = hole + 2;
        while (k < src.length && depth > 0) {
          if (src[k] === "{") depth++;
          else if (src[k] === "}") depth--;
          k++;
        }
        out += "  " + stripNonCode(src.slice(hole + 2, k - 1)) + " ";
        src = "`" + src.slice(k);
        i = 0;
        continue;
      }
      out += blank(src.slice(i, j)); i = j;
      continue;
    }
    out += c; i++;
  }
  return out;
}

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
  }
  return { missingGuardImport: missingGuardImport.sort(), unbound: unbound.sort() };
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
