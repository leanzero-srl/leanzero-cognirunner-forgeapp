/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-194 — the retired memory-cap wording, scanned on the BACKEND too.
//
// F-179/F-181 retired two phrases from every user-facing surface and added a scan to keep them
// retired. That scan lives in the browser suite (static/_screenshot-harness/editor-journeys.test.mjs)
// and walks static/{config-ui,config-view,admin-panel}/src only. So it misses the two places that
// matter most for recurrence: src/, where the refusal sentence is BUILT and where the docblock that
// names the builder lives (it asserted the builder says "prune"; the builder has not said it since
// F-174), and static/issue-glance/src, a fourth built app the scan does not know about.
//
// Retired, and why:
//   "prune"           — no control in this app prunes anything. The verb is Delete.
//   "Delete or merge" — there is no merge control; `merged` is a dedup outcome of a save.
//
// WHAT IS SCANNED, and why it is not simply "the file text". The backend is full of legitimate
// engineering uses of the word — pruneForSave, pruneOne, pruneScore, "prune revoked rows" — and a
// scan that cannot tell an identifier or a design note from a shipped sentence would force the
// reasoning to be deleted to stay green. So: comments are stripped, then only STRING AND TEMPLATE
// LITERALS are tested. That is where user-facing copy lives, and it is what the UI scan is really
// testing in JSX too. The literal extractor is deliberately simple; its positive control below
// proves it can see a sentence the app actually ships.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.CR_WORDING_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const RETIRED = [
  { re: /prune/i, why: 'the verb is "Delete" — nothing in this app prunes' },
  { re: /delete or merge/i, why: "there is no merge control to offer" },
];

// Strip block comments, then line comments. The `(^|[^:])` guard keeps `https://` inside a string
// from being read as the start of a comment and silently eating the rest of the line — which would
// turn this scan into a false PASS.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Every '…', "…" and `…` run in the (comment-stripped) source, escapes honoured. Matching is
// LINE-BOUNDED: without a full JS tokenizer a regex literal containing an apostrophe (there are
// several in src/index.js) opens a quote that never closes, and a greedy multi-line match then
// swallows hundreds of lines of unrelated code and reports it as one enormous "string". Bounding
// each match to its own line keeps a mis-parse to that line. A multi-line template literal is
// therefore seen line by line, which is fine: these are phrase matches, and the retired phrases
// are short.
const literals = (src) => src.split("\n").flatMap((line) =>
  // Lines that are console output are skipped: the retirement is about what a USER is shown,
  // and "Log prune skipped:" in a console.log is a developer's word for an eviction, not copy.
  // Nothing a tenant reads goes through console.*, so this cannot hide a real regression.
  (/console\.(log|warn|error|info|debug)/.test(line) ? [] : [...line.matchAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g)].map((m) => m[0])));

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "build") walk(f, out); }
    else if (/\.(js|jsx|mjs)$/.test(e.name)) out.push(f);
  }
  return out;
};

// src/ (the backend, including src/shared/) plus ALL FOUR built apps — the browser scan knows
// about three of them.
const roots = [
  path.join(ROOT, "src"),
  ...["config-ui", "config-view", "admin-panel", "issue-glance"].map((a) => path.join(ROOT, "static", a, "src")),
];
const files = roots.flatMap((r) => walk(r));
ok(files.length > 50, `the scan found source to read (${files.length} files across ${roots.filter(existsSync).length} roots)`);
ok(files.some((f) => f.includes(`${path.sep}src${path.sep}memories.js`)), "positive control: the BACKEND memory module is in scope");
ok(existsSync(path.join(ROOT, "static", "issue-glance", "src")) === false
  || files.some((f) => f.includes(`issue-glance${path.sep}src`)), "positive control: issue-glance is in scope when it exists");

// Positive control on the extractor: it must see a sentence the app really ships.
{
  const shipped = files.filter((f) => f.endsWith("registry-limits.js"))
    .flatMap((f) => literals(stripComments(readFileSync(f, "utf8"))));
  ok(shipped.some((s) => /Memories tab/.test(s)),
    "positive control: the literal extractor can see the shipped refusal sentence");
  ok(shipped.some((s) => /delete some in the Memories tab/i.test(s)),
    "positive control: the builder says DELETE, which is what the docblock must claim");
}

const offenders = [];
for (const f of files) {
  for (const lit of literals(stripComments(readFileSync(f, "utf8")))) {
    for (const { re, why } of RETIRED) {
      if (re.test(lit)) offenders.push(`${path.relative(ROOT, f)}: ${lit.slice(0, 120)} — ${why}`);
    }
  }
}
ok(offenders.length === 0,
  offenders.length
    ? `RETIRED WORDING IS BACK — first: ${offenders[0]}${offenders.length > 1 ? ` (and ${offenders.length - 1} more)` : ""}`
    : "no shipped string in src/ or any of the four apps retypes the retired memory-cap wording");

// And the builders themselves, EVALUATED: the one home may not produce a retired word whatever
// its input. A string scan cannot see this — the sentence is assembled at runtime from constants.
// (This half always imports the repo's real module, never CR_WORDING_ROOT — it is the shipped
// builder that has to be right; the env var exists only to verify the file scan against a copy.)
{
  const { memoryCapRefusalMessage, memoryPlatformCapMessage } = await import("../../src/shared/registry-limits.js");
  const built = [memoryCapRefusalMessage("cap"), memoryCapRefusalMessage("bytes"), memoryCapRefusalMessage(null), memoryPlatformCapMessage(1234)];
  for (const sentence of built) {
    for (const { re, why } of RETIRED) {
      ok(!re.test(sentence), `the built refusal avoids ${re} (${why}): "${sentence.slice(0, 80)}…"`);
    }
    ok(/Memories tab/.test(sentence), `the built refusal still names where to act: "${sentence.slice(0, 60)}…"`);
  }
}

console.log(`\nretired-wording: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
