/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * OFFLINE unit test for extractTextFromADF (src/index.js). The whole index.js can't be
 * imported in bare node (it uses an extensionless internal import), so this extracts the
 * REAL shipped function source via fs and evals it — no hand-copy, no module side effects.
 *   node test-harness/scripts/adf-extract.test.mjs   # exits 1 on any failure
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "..", "src", "index.js"), "utf8");

const marker = "export const extractTextFromADF =";
const start = SRC.indexOf(marker);
if (start === -1) { console.error("FAIL: extractTextFromADF not found / not exported"); process.exit(2); }
const end = SRC.indexOf("\n};", start);
if (end === -1) { console.error("FAIL: could not find function end"); process.exit(2); }
const arrow = SRC.slice(start, end + 2).replace(/^export const extractTextFromADF =\s*/, "").replace(/;?\s*$/, "");
// eslint-disable-next-line no-eval
const extractTextFromADF = eval(`(${arrow})`);

let pass = 0, fail = 0;
const eq = (got, want, msg) => { if (got === want) pass++; else { fail++; console.log(`  FAIL ${msg}\n    want: ${JSON.stringify(want)}\n    got:  ${JSON.stringify(got)}`); } };
const has = (got, sub, msg) => { if (String(got).includes(sub)) pass++; else { fail++; console.log(`  FAIL ${msg}\n    want substring: ${JSON.stringify(sub)}\n    got: ${JSON.stringify(got)}`); } };

const doc = (content) => ({ type: "doc", version: 1, content });
const para = (...kids) => ({ type: "paragraph", content: kids });
const text = (t) => ({ type: "text", text: t });

// --- THE FIX: block-level smart links (blockCard / embedCard) keep their URL ---
has(extractTextFromADF(doc([para(text("Design: ")), { type: "blockCard", attrs: { url: "https://conf.example/design-doc" } }])),
  "https://conf.example/design-doc", "blockCard URL is extracted (mixed text)");
eq(extractTextFromADF(doc([{ type: "blockCard", attrs: { url: "https://conf.example/only" } }])),
  "https://conf.example/only", "card-only description is not empty (blockCard)");
has(extractTextFromADF(doc([para(text("See ")), { type: "embedCard", attrs: { url: "https://embed.example/x" } }])),
  "https://embed.example/x", "embedCard URL is extracted");

// --- REGRESSION: existing handled cases unchanged ---
eq(extractTextFromADF(doc([para(text("hello world"))])), "hello world", "plain text");
has(extractTextFromADF(doc([para(text("link "), { type: "inlineCard", attrs: { url: "https://inline.example/y" } })])),
  "https://inline.example/y", "inlineCard still works");
has(extractTextFromADF(doc([para(text("hi "), { type: "mention", attrs: { text: "@alice" } })])), "@alice", "mention");
has(extractTextFromADF(doc([para({ type: "emoji", attrs: { shortName: ":tada:" } })])), ":tada:", "emoji");
has(extractTextFromADF(doc([para({ type: "date", attrs: { timestamp: "1700000000000" } })])), "2023-11-14", "date");
eq(extractTextFromADF(""), "", "empty string in → empty out");
eq(extractTextFromADF(null), "", "null in → empty out");
eq(extractTextFromADF("already text"), "already text", "string passthrough");
// nested list with block separators
has(extractTextFromADF(doc([{ type: "bulletList", content: [{ type: "listItem", content: [para(text("a"))] }, { type: "listItem", content: [para(text("b"))] }] }])),
  "a", "nested list text");
// a blockCard whose attrs lack a url must not throw / must not emit "undefined"
eq(extractTextFromADF(doc([{ type: "blockCard", attrs: {} }])).includes("undefined"), false, "blockCard with no url → no 'undefined' leak");

console.log(`\nextractTextFromADF: ${pass}/${pass + fail} assertions passed.`);
process.exit(fail ? 1 : 0);
