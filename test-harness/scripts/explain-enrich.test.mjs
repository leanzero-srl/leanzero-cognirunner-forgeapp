/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * OFFLINE unit test for enrichFactsWithFieldNames (src/index.js) — the "Explain this rule"
 * fix that resolves opaque customfield_* ids to their display names so the AI explanation is
 * concrete ("Story Points (customfield_10722)") instead of parroting a bare id. Extracts the
 * REAL shipped function source via fs + eval (index.js can't be bare-imported).
 *   node test-harness/scripts/explain-enrich.test.mjs   # exits 1 on any failure
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "..", "src", "index.js"), "utf8");

const m = SRC.match(/export const enrichFactsWithFieldNames =([\s\S]*?\n};)/);
if (!m) { console.error("FAIL: enrichFactsWithFieldNames not found / not exported"); process.exit(2); }
const arrow = m[1].trim().replace(/;$/, "");
// eslint-disable-next-line no-eval
const enrichFactsWithFieldNames = eval(`(${arrow})`);

const MAP = {
  customfield_10722: { name: "Story Points" },
  customfield_107: { name: "Team" },
  customfield_1072: { name: "Risk Level" },
  customfield_10099: { name: "Acceptance <<<Criteria>>>" }, // name carrying fence tokens
};

let pass = 0, fail = 0;
const eq = (got, want, msg) => { if (got === want) pass++; else { fail++; console.log(`  FAIL ${msg}\n    want: ${JSON.stringify(want)}\n    got:  ${JSON.stringify(got)}`); } };
const has = (got, sub, msg) => { if (String(got).includes(sub)) pass++; else { fail++; console.log(`  FAIL ${msg}\n    got: ${JSON.stringify(got)}`); } };
const not = (got, sub, msg) => { if (!String(got).includes(sub)) pass++; else { fail++; console.log(`  FAIL ${msg}\n    got: ${JSON.stringify(got)}`); } };

// THE FIX: opaque custom-field id → "Name (id)"
eq(enrichFactsWithFieldNames("Target field: customfield_10722", MAP),
  "Target field: Story Points (customfield_10722)", "single custom field resolved");

// Prefix collision must NOT corrupt (customfield_107 vs _1072 vs _10722) — \b boundary
has(enrichFactsWithFieldNames("A: customfield_107 B: customfield_1072 C: customfield_10722", MAP),
  "Team (customfield_107)", "prefix id 107 resolved cleanly");
has(enrichFactsWithFieldNames("A: customfield_107 B: customfield_1072 C: customfield_10722", MAP),
  "Risk Level (customfield_1072)", "id 1072 resolved cleanly (no collision with 107)");
has(enrichFactsWithFieldNames("A: customfield_107 B: customfield_1072 C: customfield_10722", MAP),
  "Story Points (customfield_10722)", "id 10722 resolved cleanly");

// Unknown id (not in map) → left as-is (graceful)
eq(enrichFactsWithFieldNames("Field: customfield_99999", MAP),
  "Field: customfield_99999", "unknown id unchanged");

// System field ids are already readable → untouched
eq(enrichFactsWithFieldNames("Field: summary\nPrompt: must be clear", MAP),
  "Field: summary\nPrompt: must be clear", "system field ids untouched");

// Name with fence tokens is defanged (no literal fence markers leak into the fenced facts)
not(enrichFactsWithFieldNames("Target field: customfield_10099", MAP), "<<<", "fence tokens stripped from resolved name");
not(enrichFactsWithFieldNames("Target field: customfield_10099", MAP), ">>>", "fence tokens stripped (close)");

// Robustness
eq(enrichFactsWithFieldNames("", MAP), "", "empty facts");
eq(enrichFactsWithFieldNames(null, MAP), "", "null facts");
eq(enrichFactsWithFieldNames("Field: customfield_10722", null), "Field: customfield_10722", "null map → unchanged");

console.log(`\nexplain-enrich: ${pass}/${pass + fail} assertions passed.`);
process.exit(fail ? 1 : 0);
