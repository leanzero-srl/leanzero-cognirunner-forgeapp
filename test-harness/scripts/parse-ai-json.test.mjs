/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for parseAIJson (src/index.js) — the tolerant JSON parser fed UNTRUSTED model output
// at ~20 callsites. It strips ```json/```js/```javascript/plain fences, salvages the first {...}/[...] block
// out of prose, repairs UNESCAPED inner double-quotes, and repairs TRUNCATED (unterminated) JSON — returning
// null (never throwing) when nothing parses. It is exported (so the async LM-Studio path parses identically),
// but index.js pulls in @forge/* which isn't installed offline, so — per the recover-verdict pattern — the
// three collaborating arrows (parseAIJson + repairTruncatedJson + repairUnescapedQuotes) are fs+eval'd out of
// source. eval runs at module top level so each arrow closes over MODULE scope; parseAIJson therefore resolves
// its two helper consts at call time. Run: node test-harness/scripts/parse-ai-json.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../../src/index.js"), "utf8");
const grab = (re, name) => {
  const m = src.match(re);
  if (!m) { console.log("FAIL: could not extract", name); process.exit(1); }
  return m[0];
};
// helpers first (parseAIJson references them by name); eval at top level → module-scope closures
// eslint-disable-next-line no-eval
const repairTruncatedJson = eval("(" + grab(/const repairTruncatedJson = \(s, start\) => \{[\s\S]*?\n\};/, "repairTruncatedJson").replace("const repairTruncatedJson = ", "").replace(/;\s*$/, "") + ")");
// eslint-disable-next-line no-eval
const repairUnescapedQuotes = eval("(" + grab(/const repairUnescapedQuotes = \(s\) => \{[\s\S]*?\n\};/, "repairUnescapedQuotes").replace("const repairUnescapedQuotes = ", "").replace(/;\s*$/, "") + ")");
// eslint-disable-next-line no-eval
const parseAIJson = eval("(" + grab(/export const parseAIJson = \(raw\) => \{[\s\S]*?\n\};/, "parseAIJson").replace("export const parseAIJson = ", "").replace(/;\s*$/, "") + ")");
// silence unused-lint: the helpers exist only so parseAIJson's closure can find them
void repairTruncatedJson; void repairUnescapedQuotes;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// === direct clean parse (fast path) =========================================================
ok(eq(parseAIJson('{"a":1,"b":"two"}'), { a: 1, b: "two" }), "clean object parses directly");
ok(eq(parseAIJson("[1, 2, 3]"), [1, 2, 3]), "clean array parses directly");
ok(eq(parseAIJson('{"a":{"b":[1,2]},"c":[{"d":true}]}'), { a: { b: [1, 2] }, c: [{ d: true }] }), "nested object/array parses directly");
ok(eq(parseAIJson('  \n {"x":1} \n  '), { x: 1 }), "surrounding whitespace is trimmed before parse");
// valid JSON scalars are accepted by the direct path (and false/0 are NOT swallowed as null)
ok(parseAIJson("42") === 42, "bare number is valid JSON → 42");
ok(parseAIJson("true") === true && parseAIJson("false") === false, "bare booleans parse (false is not treated as null)");
ok(parseAIJson('"hello"') === "hello", "bare quoted string parses");
ok(eq(parseAIJson('{"q":"she said \\"hi\\"","e":"\\u2764"}'), { q: 'she said "hi"', e: "❤" }), "escaped quotes + unicode preserved on clean parse");

// === fence stripping =========================================================================
ok(eq(parseAIJson('```json\n{"a":1}\n```'), { a: 1 }), "```json fence stripped");
ok(eq(parseAIJson('```js\n{"a":1}\n```'), { a: 1 }), "```js fence stripped");
ok(eq(parseAIJson('```javascript\n{"a":1}\n```'), { a: 1 }), "```javascript fence stripped");
ok(eq(parseAIJson('```\n{"a":1}\n```'), { a: 1 }), "plain ``` fence stripped");
ok(eq(parseAIJson('```JSON\n{"a":1}\n```'), { a: 1 }), "```JSON (uppercase) fence stripped (case-insensitive)");
ok(eq(parseAIJson('```json {"a":1}```'), { a: 1 }), "```json fence with spaces, no newline, stripped");
ok(eq(parseAIJson('\n\n```json\n{"a":1}\n```\n\n'), { a: 1 }), "outer newlines + fence both stripped");
// an unknown language fence: only the ``` is stripped, but salvage still recovers the block
ok(eq(parseAIJson('```python\n{"a":1}\n```'), { a: 1 }), "```python fence: leading ``` stripped, block salvaged");

// === prose salvage: first {...} / [...] block ===============================================
ok(eq(parseAIJson('Here is the result: {"status":"ok","count":3}. Done!'), { status: "ok", count: 3 }), "object salvaged from leading+trailing prose");
ok(eq(parseAIJson('The values are [10, 20, 30] as computed.'), [10, 20, 30]), "array salvaged from prose");
ok(eq(parseAIJson('{"a":1} extra [9,9]'), { a: 1 }), "object before array → object wins (first opening bracket)");
ok(eq(parseAIJson('[1] then {"x":2}'), [1]), "array before object → array wins (first opening bracket)");

// === repair: UNESCAPED inner double-quotes ==================================================
const uq = parseAIJson('{"reason": "a version tag "[v1]" appears"}');
ok(uq && uq.reason === 'a version tag "[v1]" appears', "unescaped inner quotes inside a balanced block are re-escaped and recovered");

// === repair: TRUNCATED (unterminated) JSON ==================================================
const tv = parseAIJson('{"isValid": false, "reason": "version tag and');
ok(tv && tv.isValid === false && tv.reason === "version tag and", "truncated mid-string: string + object closed, verdict recovered");
ok(eq(parseAIJson("[1, 2, 3"), [1, 2, 3]), "truncated array is closed");
ok(eq(parseAIJson('{"a": {"b": [1, 2'), { a: { b: [1, 2] } }), "nested truncation closes all open brackets");
ok(eq(parseAIJson('{"a": 1,'), { a: 1 }), "truncated trailing comma (no following value) is dropped");
ok(eq(parseAIJson('{"a":1,"b":'), { a: 1, b: null }), 'dangling "key": with no value → null value');
// BOTH truncated AND unescaped inner quotes → final salvage path (re-escape strays, then close)
const both = parseAIJson('{"reason": "the tag "v1" is here and the build');
ok(both && both.reason === 'the tag "v1" is here and the build', "truncated + unescaped-inner-quotes recovered by the final combined salvage");

// === the null path (nothing parses → null, never throws) ====================================
ok(parseAIJson(null) === null, "null → null");
ok(parseAIJson(undefined) === null, "undefined → null");
ok(parseAIJson("") === null, "empty string → null");
ok(parseAIJson("   \n\t ") === null, "all-whitespace → null");
ok(parseAIJson("just some prose, no json here at all") === null, "prose with no braces/brackets → null");
ok(parseAIJson("```json\n```") === null, "empty fenced block → null");
ok(parseAIJson("{ this is ] not [ json }") === null, "unrepairable garbage inside braces → null");
// two separate top-level objects: greedy first-open..last-close block can't parse → null (known limitation)
ok(parseAIJson('{"a":1} and {"b":2}') === null, "two separate top-level objects are ambiguous → null (not a merge/guess)");
// closed object with a trailing comma before } is NOT tolerated (only truncated trailing commas are)
ok(parseAIJson('{"a":1,}') === null, "trailing comma before a CLOSING brace is not tolerated → null");
// single-quoted keys/strings are not JSON and are not repaired
ok(parseAIJson("{'a':1}") === null, "single-quoted JSON is not tolerated → null");

// === robustness: object input has no passthrough (contract is string content) ===============
ok(parseAIJson({ a: 1 }) === null, "an already-parsed object is NOT passed through (stringifies to [object Object]) → null");

console.log(`\nparse-ai-json: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
