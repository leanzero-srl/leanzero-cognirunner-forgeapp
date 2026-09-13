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

// The rule block whose selector is this class on its own or in a compound with other
// classes (".fix-result.memory-card") — never a longer class name (".hard-stop-title"),
// a descendant selector or a dark-mode variant. Normalised: leading indentation and
// blank lines removed, so only the declarations themselves are compared.
const ruleBlock = (css, selector) => {
  const cls = selector.replace(/[.]/g, "\\.");
  const re = new RegExp(`(^|[\\n;}])\\s*((?:\\.[\\w-]+)*)${cls}((?:\\.[\\w-]+)*)\\s*\\{`, "m");
  const m = re.exec(css);
  if (!m) return null;
  const open = css.indexOf("{", m.index + m[0].length - 1);
  const close = css.indexOf("}", open);
  assert.notEqual(close, -1, `unterminated block for ${selector}`);
  return css.slice(open + 1, close)
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
};

const homes = [
  { name: "config-ui/src/App.js injectStyles()", css: functionBody(read("static/config-ui/src/App.js"), "const injectStyles = () => {", "config-ui App.js") },
  { name: "admin-panel/src/App.js injectCopiedComponentStyles()", css: functionBody(read("static/admin-panel/src/App.js"), "const injectCopiedComponentStyles = () => {", "admin-panel App.js") },
  { name: "config-ui/src/styles.css", css: read("static/config-ui/src/styles.css") },
  { name: "admin-panel/src/styles.css", css: read("static/admin-panel/src/styles.css") },
];

const failures = [];
for (const cls of SHARED_CSS_CLASSES) {
  const found = homes.map((h) => ({ home: h.name, block: ruleBlock(h.css, cls) }));
  const reference = found.find((f) => f.block !== null);
  if (!reference) { failures.push(`${cls}: declared in NO home at all`); continue; }
  for (const f of found) {
    if (f.block === null) failures.push(`${cls}: MISSING from ${f.home} (present in ${reference.home})`);
    else if (f.block !== reference.block) failures.push(`${cls}: DRIFTED in ${f.home} vs ${reference.home}`);
  }
}

if (failures.length) {
  console.error(`CSS parity: ${failures.length} problem(s) across ${SHARED_CSS_CLASSES.length} shared classes`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  assert.fail(`css parity: ${failures[0]}`);
}
console.log(`CSS parity: ${SHARED_CSS_CLASSES.length} shared classes identical across ${homes.length} homes`);
