/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Deterministic unit checks for F52 (resolve flagged items 1 & 2):
//  (1) agentic JQL confinement — confineJqlToProject (copied from src/index.js)
//  (2) static-sandbox eval shadowing as an AsyncFunction param.

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}`); } };

// ---- Item 1: JQL confinement (verbatim copy of the FIXED logic) ----
const PROJECT_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,254}$/;
const jqlParensBalancedOutsideStrings = (s) => {
  let depth = 0, inStr = false, esc = false;
  for (const ch of String(s)) {
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "(") depth++;
    else if (ch === ")") { if (--depth < 0) return false; }
  }
  return depth === 0 && !inStr;
};
const confineJqlToProject = (rawJql, projectKey) => {
  if (!projectKey || !PROJECT_KEY_RE.test(projectKey)) return { ok: false, reason: "project scope could not be determined" };
  const raw = String(rawJql || "").trim();
  const om = raw.match(/\s+order\s+by\s+/i);
  const where = om ? raw.slice(0, om.index).trim() : raw;
  const order = om ? " " + raw.slice(om.index).trim() : "";
  if (!jqlParensBalancedOutsideStrings(where)) return { ok: false, reason: "search query had unbalanced parentheses" };
  const body = where ? `(${where}) AND project = "${projectKey}"` : `project = "${projectKey}"`;
  return { ok: true, jql: body + order };
};

const K = "COGTEST";
console.log("Item 1 — agentic JQL confinement:");

// 1. OR/NOT "escape" attempt → wrapped; the outer top-level AND confines EVERY row.
let r = confineJqlToProject('text ~ "login" AND NOT project = "KEY" OR project = "OTHER"', K);
ok("OR/NOT attempt → wrapped + trailing AND project (confined)",
  r.ok && r.jql === '(text ~ "login" AND NOT project = "KEY" OR project = "OTHER") AND project = "COGTEST"');

// 2. ORDER BY preserved as the final clause; project filter inserted before it.
r = confineJqlToProject('summary ~ "x" ORDER BY updated DESC', K);
ok("ORDER BY kept last, project clause before it",
  r.ok && r.jql === '(summary ~ "x") AND project = "COGTEST" ORDER BY updated DESC');

// 3. Unbalanced parens (the only real bypass) → FAIL CLOSED.
r = confineJqlToProject('text ~ "foo") OR (project = OTHER', K);
ok("unbalanced parens → refused (fail closed)", r.ok === false && /paren/i.test(r.reason));

// 4. Parens INSIDE a string literal are not counted → still balanced.
r = confineJqlToProject('summary ~ "a) (b"', K);
ok("parens inside a quoted string ignored → confined", r.ok === true && r.jql.includes('AND project = "COGTEST"'));

// 5. Empty model query + key → bare project filter.
r = confineJqlToProject('', K);
ok("empty query → project = KEY only", r.ok === true && r.jql === 'project = "COGTEST"');

// 6. Injection via the project key itself → blocked by PROJECT_KEY_RE.
r = confineJqlToProject('text ~ "x"', 'KEY" OR "1"="1');
ok("malicious project key → refused (regex gate)", r.ok === false);

// 7. Missing key (CREATE / no project) → fail closed, never unscoped.
ok("null key → refused", confineJqlToProject('text ~ "x"', null).ok === false);
ok("undefined key → refused", confineJqlToProject('text ~ "x"', undefined).ok === false);

// 8. Normal in-project query → confined, original intact inside the wrap.
r = confineJqlToProject('text ~ "payment"', K);
ok("normal query → wrapped, criteria preserved", r.ok && r.jql === '(text ~ "payment") AND project = "COGTEST"');

// 9. project IN (...) cross-project attempt → still confined by the outer AND.
r = confineJqlToProject('project IN (RIVAL1, RIVAL2) AND text ~ "y"', K);
ok("project IN(...) attempt → wrapped + outer AND project (zero cross-project rows)",
  r.ok && r.jql.endsWith('AND project = "COGTEST"') && r.jql.startsWith('(project IN'));

// ---- Item 2: eval shadowed as an AsyncFunction param (sloppy-mode, no "use strict") ----
console.log("Item 2 — static-sandbox eval shadowing:");
const AF = Object.getPrototypeOf(async function () {}).constructor;
ok("eval is constructible as a sandbox param (no SyntaxError)", (() => {
  try { new AF("api", "vars", "eval", "return 1"); return true; } catch { return false; }
})());
const evalShadow = await new AF("api", "vars", "eval", "return typeof eval")({}, {}, undefined);
ok("eval is undefined inside the sandbox", evalShadow === "undefined");

console.log(`\n=== F52 verification: ${pass} passed, ${fail} failed ${fail ? "❌" : "✅"} ===`);
process.exit(fail ? 1 : 0);
