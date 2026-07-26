/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
// DIAGNOSTIC (read-only) — REFINES the it31 finding: does the PRIMARY parser parseAIJson already handle the
// trailing-prose cases UPSTREAM (so recoverValidatorVerdict — the fallback — never sees them in production)?
// If yes, the it31 fallback bug has a NARROWER real-world trigger than "any trailing prose".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/index.js"), "utf8");
const grab = (re, name) => { const m = src.match(re); if (!m) { console.log("FAIL extract", name); process.exit(1); } return m[0]; };
// Extract parseAIJson + its two repair helpers, strip the `export`, eval together.
const pj = grab(/export const parseAIJson = \(raw\) => \{[\s\S]*?\n\};/, "parseAIJson").replace("export ", "");
const rt = grab(/const repairTruncatedJson = \(s, start\) => \{[\s\S]*?\n\};/, "repairTruncatedJson");
const rq = grab(/const repairUnescapedQuotes = \(s\) => \{[\s\S]*?\n\};/, "repairUnescapedQuotes");
const parseAIJson = eval(`(() => { ${rt}\n${rq}\n${pj}\n return parseAIJson; })()`);

const CASES = [
  { n: "clean JSON", in: '{"isValid": true, "reason": "Not a duplicate."}' },
  { n: "★ trailing prose after JSON", in: '{"isValid": true, "reason": "Not a duplicate — 3 candidates cover different bugs."}\n\nI searched COGTEST and none match.' },
  { n: "★ fenced json + prose", in: 'Here is my answer:\n```json\n{"isValid": false, "reason": "Duplicate of BUG-42."}\n```\nThat is final.' },
  { n: "prose WITH braces (parseAIJson may fail → fallback runs)", in: '{"isValid": true, "reason": "ok"} then I noted {count: 3} more issues.' },
];
let handled = 0;
for (const c of CASES) {
  const r = parseAIJson(c.in);
  const reason = r && typeof r === "object" ? r.reason : "(null/failed)";
  const ok = r && r.isValid !== undefined && r.reason && !/malformed/i.test(String(r.reason));
  if (ok) handled++;
  console.log((ok ? "HANDLED  " : "FELL-THRU") + " | " + c.n.padEnd(52) + " | reason=" + JSON.stringify(String(reason).slice(0, 50)));
}
console.log(`\nparseAIJson handled ${handled}/${CASES.length} upstream. If the two ★ trailing-prose cases are HANDLED, the it31 fallback bug's real trigger is NARROWER than "any trailing prose" — it needs parseAIJson to ALSO fail (braces-in-prose / genuinely-malformed JSON).`);
