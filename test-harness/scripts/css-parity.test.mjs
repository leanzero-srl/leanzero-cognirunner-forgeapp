/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// F-222 — shared component CSS has FOUR homes and nothing kept them equal: the live
// CSS in config-ui's injectStyles(), admin-panel's injectCopiedComponentStyles()
// (which carries the components copied from config-ui), and the two styles.css
// convention mirrors. A class whose declarations drift between them renders
// differently in the two apps and the mirror silently lies. This test fails naming
// the FIRST drifted class and the home it drifted in.
//
// Scope is deliberately a small explicit list, not "every class": these are the
// shared component classes the duplication convention must carry.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHARED_CSS_CLASSES = [".hard-stop", ".step-busy-note", ".async-error-note", ".memory-card"];

const read = (rel) => readFileSync(path.join(repo, rel), "utf8");

// Slice the body of a named arrow function by brace-matching from its opening "{".
// CSS braces inside the template literal are balanced, so plain counting is safe.
const functionBody = (source, marker, where) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${where}: could not find ${marker}`);
  const open = source.indexOf("{", start + marker.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  assert.fail(`${where}: unbalanced braces after ${marker}`);
};

// F-226 — the old matcher looked at the BARE class only, so `.hard-stop-title`,
// `.hard-stop-text` and `html[data-color-mode="dark"] .hard-stop` were out of scope
// and drifted freely (a 700→400 title weight and a dark hue change both passed).
// Scope is now every rule whose selector CONTAINS the class token: the class itself,
// its `-`-suffixed siblings, descendant/compound selectors and dark-mode variants,
// including rules nested in @media/@supports (the at-rule context is part of the key).
//
// Flatten a stylesheet into [{ selector, declarations }], where `selector` carries any
// enclosing at-rule prelude ("@media (...) » .foo"). Declarations are dedented and
// blank-line-stripped so only the declarations themselves are compared.
// CSS comments are stripped FIRST: these blocks carry long provenance comments that
// name other classes, and an unstripped comment both pollutes the selector key and
// makes a prose edit read as a style drift.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const flatten = (css) => {
  const out = [];
  const walk = (text, context) => {
    let i = 0, chunkStart = 0, depth = 0, open = -1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "{") {
        if (depth === 0) open = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const prelude = text.slice(chunkStart, open).trim().replace(/\s+/g, " ");
          const body = text.slice(open + 1, i);
          if (prelude.startsWith("@") && /\{/.test(body)) walk(body, context.concat(prelude));
          else if (prelude) {
            out.push({
              selector: context.concat(prelude).join(" » "),
              declarations: body.split("\n").map((l) => l.trim()).filter(Boolean).join("\n"),
            });
          }
          chunkStart = i + 1;
        }
      }
      i++;
    }
  };
  walk(stripComments(css), []);
  return out;
};

// `.hard-stop` matches `.hard-stop`, `.hard-stop-title`, `.x.hard-stop`, but never
// `.hard-stopper` (a `-` suffix is a sibling; a bare letter is a different class).
const touches = (selector, cls) =>
  new RegExp(`\\${cls}(?:-[\\w-]+)*(?![\\w-])`).test(selector);

// Every rule in this home that touches the class, keyed by its normalised selector.
const relatedBlocks = (css, cls) => {
  const map = new Map();
  for (const rule of flatten(css)) {
    if (!touches(rule.selector, cls)) continue;
    // Two rules with the same selector in one home: concatenate in source order,
    // which is what the cascade does anyway.
    map.set(rule.selector, map.has(rule.selector)
      ? `${map.get(rule.selector)}\n${rule.declarations}` : rule.declarations);
  }
  return map;
};

const homes = [
  { name: "config-ui/src/App.js injectStyles()", css: functionBody(read("static/config-ui/src/App.js"), "const injectStyles = () => {", "config-ui App.js") },
  { name: "admin-panel/src/App.js injectCopiedComponentStyles()", css: functionBody(read("static/admin-panel/src/App.js"), "const injectCopiedComponentStyles = () => {", "admin-panel App.js") },
  { name: "config-ui/src/styles.css", css: read("static/config-ui/src/styles.css") },
  { name: "admin-panel/src/styles.css", css: read("static/admin-panel/src/styles.css") },
];

const failures = [];
let compared = 0;
for (const cls of SHARED_CSS_CLASSES) {
  const found = homes.map((h) => ({ home: h.name, rules: relatedBlocks(h.css, cls) }));
  const reference = found.find((f) => f.rules.size > 0);
  if (!reference) { failures.push(`${cls}: declared in NO home at all`); continue; }
  // Union of selectors so a rule PRESENT only in a non-reference home is caught too.
  const selectors = [...new Set(found.flatMap((f) => [...f.rules.keys()]))].sort();
  for (const selector of selectors) {
    const ref = found.find((f) => f.rules.has(selector));
    for (const f of found) {
      compared++;
      if (!f.rules.has(selector)) failures.push(`${selector}: MISSING from ${f.home} (present in ${ref.home})`);
      else if (f.rules.get(selector) !== ref.rules.get(selector)) failures.push(`${selector}: DRIFTED in ${f.home} vs ${ref.home}`);
    }
  }
}

if (failures.length) {
  console.error(`CSS parity: ${failures.length} problem(s) across ${SHARED_CSS_CLASSES.length} shared classes`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  assert.fail(`css parity: ${failures[0]}`);
}
console.log(`CSS parity: ${SHARED_CSS_CLASSES.length} shared classes — ${compared} rule/home comparisons identical across ${homes.length} homes`);
