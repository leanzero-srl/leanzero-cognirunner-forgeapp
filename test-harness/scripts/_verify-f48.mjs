/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Unit checks for F48 (hunt-3) fixes — focus on the riskiest: stripCodeFences must strip
// only a WRAPPER fence and never corrupt valid code that contains an inner ``` as data.

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}  →  got: ${JSON.stringify(c)}`); } };

const stripCodeFences = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return text;
  const lines = text.split("\n");
  let openIdx = -1;
  if (/^```/.test(lines[0])) openIdx = 0;
  else if (lines.length > 1 && /^```/.test(lines[1]) && /^[A-Za-z].{0,80}$/.test(lines[0].trim())) openIdx = 1;
  if (openIdx === -1) return text;
  let closeIdx = -1;
  for (let i = lines.length - 1; i > openIdx; i--) { if (/^```\s*$/.test(lines[i])) { closeIdx = i; break; } }
  const body = closeIdx === -1 ? lines.slice(openIdx + 1) : lines.slice(openIdx + 1, closeIdx);
  return body.join("\n").trim();
};

console.log("Fix — stripCodeFences (wrapper-only, preserves inner data fences):");
ok('```js wrapper → unwrapped', stripCodeFences("```js\nconst x = 1;\n```") === "const x = 1;");
ok('plain ``` wrapper → unwrapped', stripCodeFences("```\nconst x = 1;\n```") === "const x = 1;");
ok('prose intro + fence → unwrapped', stripCodeFences("Here's the code:\n```js\nconst x = 1;\n```") === "const x = 1;");
ok('no fences → unchanged', stripCodeFences("const x = 1;\nreturn x;") === "const x = 1;\nreturn x;");
// THE BUG: valid code whose body contains a column-0 ``` (inside a template literal / markdown string)
const innerFence = 'const doc = `\n# Title\n```\nexample code\n```\ndone`;\nawait api.updateIssue(k, { description: doc });';
ok('valid code with INNER ``` data → NOT corrupted (preserved whole)', stripCodeFences(innerFence) === innerFence);
// wrapper + inner data fence: strip only the outer wrapper, keep the inner
const wrapped = "```js\nconst doc = `\n```\ninner\n```\n`;\n```";
const expected = "const doc = `\n```\ninner\n```\n`;";
ok('wrapper around code-with-inner-fence → strips wrapper, keeps inner', stripCodeFences(wrapped) === expected);
ok('unclosed wrapper fence → takes rest as body', stripCodeFences("```js\nconst x = 1;") === "const x = 1;");

console.log(`\n=== F48 verification: ${pass} passed, ${fail} failed ${fail ? "❌" : "✅"} ===`);
process.exit(fail ? 1 : 0);
