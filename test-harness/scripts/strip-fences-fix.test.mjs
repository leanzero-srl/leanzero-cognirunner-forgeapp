/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for stripCodeFences + parseFixResponse (src/index.js) — both exported so the
// async (LM Studio) codegen/fix handler in src/async-handler.js parses AI output IDENTICALLY.
//   * stripCodeFences: strips a WRAPPER ```lang … ``` (or plain ```), tolerates one short prose
//     intro ("Here's the code:"), and — critically — leaves a fence DEEP in the body untouched
//     (the it-fix that stopped `search(/^```/m)` from deleting valid code before an inner fence).
//   * parseFixResponse: coerces the fix AI's {code, explanation, memoryCandidate} shape — JSON first
//     (via parseAIJson), falling back to whole-response-as-code ONLY when JSON parsing fails; clamps
//     explanation<=400, memoryCandidate.content<=350, projectScoped strictly === true.
// index.js can't be bare-imported offline (missing src/test-hook + @forge/*), so the REAL shipped
// sources are extracted via fs + Function (the project's recover-verdict.test.mjs pattern). Run:
//   node --import ../lib/register-mocks.mjs scripts/strip-fences-fix.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(here, "../../src/index.js"), "utf8");

// Extract each REAL function source (non-greedy up to the first column-0 `\n};`). parseFixResponse
// depends on parseAIJson (→ repairTruncatedJson, repairUnescapedQuotes) and stripCodeFences, so all
// five are evaluated together in one shared scope. They are const arrow fns that reference each other
// only at call time, so declaration order among them is irrelevant.
const grab = (re, label) => {
  const m = SRC.match(re);
  if (!m) { console.log("FAIL: could not extract", label); process.exit(1); }
  return m[0].replace(/^export\s+/, "");
};
const srcStripFences = grab(/export const stripCodeFences = \(raw\) => \{[\s\S]*?\n\};/, "stripCodeFences");
const srcParseAIJson = grab(/export const parseAIJson = \(raw\) => \{[\s\S]*?\n\};/, "parseAIJson");
const srcRepairTrunc = grab(/const repairTruncatedJson = \(s, start\) => \{[\s\S]*?\n\};/, "repairTruncatedJson");
const srcRepairQuotes = grab(/const repairUnescapedQuotes = \(s\) => \{[\s\S]*?\n\};/, "repairUnescapedQuotes");
const srcParseFix = grab(/export const parseFixResponse = \(content\) => \{[\s\S]*?\n\};/, "parseFixResponse");

// eslint-disable-next-line no-new-func
const factory = new Function(`
${srcStripFences}
${srcRepairTrunc}
${srcRepairQuotes}
${srcParseAIJson}
${srcParseFix}
return { stripCodeFences, parseFixResponse };
`);
const { stripCodeFences, parseFixResponse } = factory();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// ==========================================================================================
// stripCodeFences
// ==========================================================================================

// --- bare code (no fence) is returned unchanged ---
ok(stripCodeFences("const x = 1;") === "const x = 1;", "bare code without fences returned as-is");

// --- every wrapper language variant strips to the inner body ---
ok(stripCodeFences("```javascript\nconst x = 1;\n```") === "const x = 1;", "```javascript wrapper stripped");
ok(stripCodeFences("```js\nconst x = 1;\n```") === "const x = 1;", "```js wrapper stripped");
ok(stripCodeFences("```typescript\nconst x = 1;\n```") === "const x = 1;", "```typescript wrapper stripped");
ok(stripCodeFences("```ts\nconst x = 1;\n```") === "const x = 1;", "```ts wrapper stripped");
ok(stripCodeFences("```\nconst x = 1;\n```") === "const x = 1;", "plain ``` wrapper stripped");

// --- one SHORT prose intro before the opening fence is tolerated (openIdx = 1) ---
ok(stripCodeFences("Here's the fixed code:\n```js\nconst x = 1;\n```") === "const x = 1;",
  "single short prose intro then fence → intro + fences stripped");

// --- a fence DEEP in the body is DATA, not a wrapper: the whole string returns UNCHANGED ---
const midFence = "const code = 1;\nconst md = '```sql SELECT 1 ```';\nreturn code;";
ok(stripCodeFences(midFence) === midFence,
  "a ``` mid-body (not at line 0/1) is not a wrapper → code preserved verbatim (anti-corruption)");

// --- multiple fences: only the LAST standalone ``` closes; inner fences survive ---
ok(stripCodeFences("```js\nlineA\n```\nlineB\n```") === "lineA\n```\nlineB",
  "multi-fence: opener=line0, closer=LAST ```; inner ``` kept in body");

// --- opening fence with NO closing fence → everything after the opener is the body ---
ok(stripCodeFences("```js\nconst x = 1;") === "const x = 1;", "opening fence, no closer → body after opener");

// --- blank lines just inside the fence are trimmed off the body ---
ok(stripCodeFences("```\n\nconst x = 1;\n\n```") === "const x = 1;", "leading/trailing blank lines inside fence trimmed");

// --- a closing fence with trailing whitespace still counts (/^```\s*$/) ---
ok(stripCodeFences("```js\nconst x = 1;\n```   ") === "const x = 1;", "closing ``` with trailing spaces still closes");

// --- a prose intro that is TOO LONG (>81 chars) is NOT a recognized intro → nothing stripped ---
const longProse = "T" + "x".repeat(90); // 91 chars, exceeds the /^[A-Za-z].{0,80}$/ intro cap
const longProseIn = longProse + "\n```js\nconst x = 1;\n```";
ok(stripCodeFences(longProseIn) === longProseIn.trim(),
  "over-long prose intro is not stripped (documented: only a SHORT intro is peeled)");

// --- a prose intro NOT starting with a letter is not a recognized intro → nothing stripped ---
const digitProse = "1) code below:\n```js\nx=1\n```";
ok(stripCodeFences(digitProse) === digitProse.trim(), "non-letter-leading intro line is not peeled");

// --- empty / nullish inputs coerce to "" ---
ok(stripCodeFences(null) === "", "null → empty string");
ok(stripCodeFences(undefined) === "", "undefined → empty string");
ok(stripCodeFences("") === "", "empty string → empty string");
ok(stripCodeFences("   \n  ") === "", "whitespace-only → empty string");

// ==========================================================================================
// parseFixResponse
// ==========================================================================================

// --- fully-formed JSON: code + explanation + memoryCandidate all carried through ---
const full = parseFixResponse('{"code":"const x=1;","explanation":"fixed the null deref","memoryCandidate":{"content":"remember to guard nulls","projectScoped":true}}');
ok(full.code === "const x=1;", "valid JSON: code extracted");
ok(full.explanation === "fixed the null deref", "valid JSON: explanation extracted");
ok(full.memoryCandidate && full.memoryCandidate.content === "remember to guard nulls" && full.memoryCandidate.projectScoped === true,
  "valid JSON: memoryCandidate {content, projectScoped:true} extracted");

// --- code fenced INSIDE the JSON string value is de-fenced via stripCodeFences ---
const fencedCode = parseFixResponse('{"code":"```js\\nconst x=1;\\n```","explanation":"e"}');
ok(fencedCode.code === "const x=1;", "code fenced inside the JSON value is de-fenced");

// --- ```json-fenced JSON envelope: parseAIJson unwraps it before shape coercion ---
const jsonEnvelope = parseFixResponse('```json\n{"code":"y=2","explanation":"e2"}\n```');
ok(jsonEnvelope.code === "y=2" && jsonEnvelope.explanation === "e2", "```json-fenced JSON envelope parsed");

// --- prose-wrapped JSON is salvaged by parseAIJson's first-{...}-block extractor ---
const proseJson = parseFixResponse('Sure! {"code":"const a=1;","explanation":"fixed"} hope that helps');
ok(proseJson.code === "const a=1;" && proseJson.explanation === "fixed", "prose-wrapped JSON is salvaged");

// --- JSON object with NO code field → code:"" but explanation is still surfaced ---
const noCode = parseFixResponse('{"explanation":"could not repair this one"}');
ok(noCode.code === "" && noCode.explanation === "could not repair this one" && noCode.memoryCandidate === null,
  "missing code field → code:'' with explanation preserved");

// --- whitespace-only code counts as empty → code:"" ---
ok(parseFixResponse('{"code":"   ","explanation":"e"}').code === "", "whitespace-only code → code:''");

// --- non-string code (number) → code:"" ---
ok(parseFixResponse('{"code":123}').code === "", "non-string code → code:''");

// --- non-string explanation is dropped to null (both in the with-code and empty-code branches) ---
ok(parseFixResponse('{"code":"x=1","explanation":123}').explanation === null, "numeric explanation → null (with code)");
ok(parseFixResponse('{"code":"x=1","explanation":{"a":1}}').explanation === null, "object explanation → null (with code)");
ok(parseFixResponse('{"explanation":42}').explanation === null, "numeric explanation → null (empty-code branch)");

// --- memoryCandidate coercions ---
ok(parseFixResponse('{"code":"x","memoryCandidate":{"content":"m"}}').memoryCandidate.projectScoped === false,
  "memoryCandidate without projectScoped defaults to false");
ok(parseFixResponse('{"code":"x","memoryCandidate":{"content":"m","projectScoped":"yes"}}').memoryCandidate.projectScoped === false,
  "projectScoped non-boolean 'yes' is NOT true (strict === true)");
ok(parseFixResponse('{"code":"x","memoryCandidate":{"content":"   "}}').memoryCandidate === null,
  "memoryCandidate with blank content → null");
ok(parseFixResponse('{"code":"x","memoryCandidate":"nope"}').memoryCandidate === null,
  "memoryCandidate that is not an object → null");
ok(parseFixResponse('{"code":"x","memoryCandidate":{"projectScoped":true}}').memoryCandidate === null,
  "memoryCandidate missing content → null");

// --- clamps: explanation <= 400, memoryCandidate.content trimmed then <= 350 ---
const longExpl = parseFixResponse(JSON.stringify({ code: "x=1", explanation: "y".repeat(500) }));
ok(longExpl.explanation.length === 400, "explanation clamped to 400 chars (with code)");
const longExplNoCode = parseFixResponse(JSON.stringify({ explanation: "y".repeat(500) }));
ok(longExplNoCode.code === "" && longExplNoCode.explanation.length === 400, "explanation clamped to 400 also in empty-code branch");
const longMem = parseFixResponse(JSON.stringify({ code: "x=1", memoryCandidate: { content: "  " + "z".repeat(400) + "  " } }));
ok(longMem.memoryCandidate.content.length === 350 && !/^\s/.test(longMem.memoryCandidate.content),
  "memoryCandidate.content trimmed then clamped to 350 chars");

// --- NON-JSON response: whole content becomes code (parseAIJson returns null → stripCodeFences fallback) ---
const plain = parseFixResponse("const x = 1;\nawait api.updateIssue({ summary });");
ok(plain.code === "const x = 1;\nawait api.updateIssue({ summary });" && plain.explanation === null && plain.memoryCandidate === null,
  "non-JSON code (even with braces) falls through to whole-response-as-code");

// --- non-JSON code wrapped in a bare fence (no JSON envelope) → de-fenced code ---
const bareFenced = parseFixResponse("```javascript\nconst x = 1;\n```");
ok(bareFenced.code === "const x = 1;" && bareFenced.explanation === null, "bare-fenced (non-JSON) code → de-fenced, no explanation");

// --- nullish / empty content → code:'' via the null-parse path ---
ok(parseFixResponse(null).code === "" && parseFixResponse("").code === "", "null/empty content → code:''");

// --- a JSON array is a truthy object but has no string code → code:'' ---
const arr = parseFixResponse("[1,2,3]");
ok(arr.code === "" && arr.explanation === null && arr.memoryCandidate === null, "JSON array → code:'' (object branch, no code field)");

// --- a bare JSON PRIMITIVE (number) is not an object → treated as code via the else branch ---
ok(parseFixResponse("42").code === "42", "bare JSON primitive (42) → treated as code, not the object branch");

// --- the return shape always has exactly these three keys ---
const shape = parseFixResponse('{"code":"x=1"}');
ok(["code", "explanation", "memoryCandidate"].every((k) => k in shape) && Object.keys(shape).length === 3,
  "result shape is exactly {code, explanation, memoryCandidate}");

console.log(`\nstrip-fences-fix: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
