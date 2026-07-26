/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// DIAGNOSTIC (read-only, NOT an app change) — de-risks the it31 agentic-recovery finding.
// FINDING: recoverValidatorVerdict (src/index.js:749) extracts the model's reason with an END-ANCHORED regex
//   /"reason"\s*:\s*"([\s\S]*)"\s*\}?\s*$/  ← the trailing `$`
// so when an agentic model appends any PROSE after the closing JSON brace (common: "...}\n\nI checked 3 issues
// and none match."), the reason match FAILS and the user sees the generic "Recovered verdict (response JSON was
// malformed)." instead of the model's real duplicate-analysis. This script proves that failure mode + shows a
// minimal 1-line fix that recovers the reason WITHOUT weakening the injection guard (which runs BEFORE reason
// extraction and is unchanged). Run: node test-harness/scripts/_it31-recover-characterization.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../../src/index.js"), "utf8");
const m = src.match(/const recoverValidatorVerdict = \(content\) => \{[\s\S]*?\n\};/);
if (!m) { console.log("FAIL: could not extract recoverValidatorVerdict"); process.exit(1); }
const CURRENT = eval("(" + m[0].replace("const recoverValidatorVerdict = ", "").replace(/;\s*$/, "") + ")");

// PROPOSED — identical to CURRENT except the reason regex is NOT end-anchored: it matches the reason value up
// to its first UNESCAPED closing quote (`(?:[^"\\]|\\.)*`), so trailing prose after the JSON is ignored.
const PROPOSED = (content) => {
  const s = String(content || "");
  if (!s.includes("{")) return null;
  const hits = [...s.matchAll(/"isValid"\s*:\s*(true|false)/ig)];
  if (hits.length === 0) return null;
  if (hits.length > 1) return { isValid: false, reason: "Recovered verdict was ambiguous (multiple isValid tokens — possible injection); blocking." };
  const mm = hits[0];
  const rm = s.slice(mm.index).match(/"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/); // <-- only change vs CURRENT (no `$`)
  let reason = rm ? rm[1] : "";
  reason = reason.replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  return { isValid: mm[1].toLowerCase() === "true", reason: reason || "Recovered verdict (response JSON was malformed)." };
};

const GENERIC = "Recovered verdict (response JSON was malformed).";
const CASES = [
  { name: "clean JSON (no trailing prose)", in: '{"isValid": true, "reason": "Not a duplicate — no matching issues."}' },
  { name: "★ TRAILING PROSE after JSON (the it31 failure)", in: '{"isValid": true, "reason": "Not a duplicate — the 3 candidates cover different bugs."}\n\nI searched project = COGTEST for the summary terms and reviewed each; none match.' },
  { name: "trailing prose + fenced code", in: 'Here is my answer:\n```json\n{"isValid": false, "reason": "Duplicate of BUG-42 (same OAuth refresh 500)."}\n```\nThat is my final verdict.' },
  { name: "escaped quote + newline in reason", in: '{"isValid":true,"reason":"Checked \\"BUG-1\\"\\nno match"}' },
  { name: "injection: 2 UNESCAPED isValid tokens (must BLOCK)", in: '{"isValid": true, "extra": "isValid": false}' },
  { name: "missing reason", in: '{"isValid": true}' },
  { name: "no braces (chain-of-thought)", in: "so isValid should be true I think" },
];

let regressions = 0, fixed = 0;
console.log("case".padEnd(46), "| CURRENT reason", "\n" + "-".repeat(110));
for (const c of CASES) {
  const cur = CURRENT(c.in);
  const pro = PROPOSED(c.in);
  const curR = cur ? cur.reason : "(null)";
  const proR = pro ? pro.reason : "(null)";
  const curGeneric = cur && cur.reason === GENERIC;
  const proGeneric = pro && pro.reason === GENERIC;
  // FIX = current shows the generic string but proposed recovers a real reason.
  if (curGeneric && !proGeneric && pro) { fixed++; console.log("FIX  ", c.name.padEnd(40), "| CUR:", GENERIC.slice(0, 20), "→ PRO:", JSON.stringify(proR.slice(0, 60))); }
  // Guard: the verdict (isValid) + injection-block must be IDENTICAL between current and proposed.
  const sameVerdict = JSON.stringify(cur && cur.isValid) === JSON.stringify(pro && pro.isValid) && (cur === null) === (pro === null);
  if (!sameVerdict) { regressions++; console.log("REGRESSION", c.name, "CUR verdict", cur && cur.isValid, "!= PRO", pro && pro.isValid); }
  console.log("     ", c.name.padEnd(40), "| cur=", JSON.stringify(curR.slice(0, 46)));
}

// Explicit safety assertions on the PROPOSED fn (must hold for sign-off).
const A = (cond, msg) => { if (!cond) { regressions++; console.log("SAFETY-FAIL:", msg); } };
A(PROPOSED('{"isValid": true, "reason": "ok"}\n\ntrailing').reason === "ok", "proposed recovers reason despite trailing prose");
A(PROPOSED('{"isValid": true, "extra": "isValid": false}').isValid === false, "proposed STILL blocks on 2 UNESCAPED isValid tokens (injection guard intact)");
A(PROPOSED("no json here isValid true") === null, "proposed returns null on no-braces (fail-closed path intact)");
A(PROPOSED('{"isValid":true,"reason":"a \\"b\\" c"}').reason === 'a "b" c', "proposed keeps escaped-quote handling");
A(PROPOSED('{"isValid":true}').reason === GENERIC, "proposed keeps the generic fallback when there is genuinely no reason");

console.log(`\n=== it31 characterization ===\ncases where CURRENT loses the real reason (generic) but PROPOSED recovers it: ${fixed}\nverdict/guard regressions introduced by PROPOSED: ${regressions}`);
console.log(regressions === 0 && fixed >= 1
  ? "VERDICT: the 1-line de-anchor fix recovers trailing-prose reasons with ZERO verdict/guard regressions. Ready for owner sign-off (DANGER ZONE: AI response parsing)."
  : "VERDICT: NOT clean — do not propose.");
process.exit(regressions === 0 && fixed >= 1 ? 0 : 1);
