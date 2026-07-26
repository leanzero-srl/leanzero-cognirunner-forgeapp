/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/narrate-utils.js — the dependency-free "narrate dry-run" helpers
// shared by the backend resolver and the config-ui/admin-panel FunctionBlock. Pure module, no @forge/*,
// so it imports directly. Covers ALL four exports:
//   - clampNarrateLine  (server-side sanitizer of UNTRUSTED model output — the risk-bearing one):
//       nullish/non-string → "", code-fence + <<<>>> + markdown removal, bullet-marker strip, whitespace
//       collapse, surrounding-quote strip (straight + curly), and the hard length clamp (+ ellipsis).
//   - buildDryRunFacts   (changes[] → bounded one-line-per-change plain text; per-action templates,
//       missing-key fallbacks, generic fallback for unknown actions, value truncation, 40-change cap,
//       4000-char cap).
//   - countChangeVerbs   (authoritative per-verb counts; non-array → {}, missing action → "change").
//   - CHANGE_VERB_LABEL  (static human-label map).
// Run: node --import ../lib/register-mocks.mjs scripts/narrate-utils.test.mjs
import {
  clampNarrateLine, buildDryRunFacts, countChangeVerbs, CHANGE_VERB_LABEL,
} from "../../src/shared/narrate-utils.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ===================== clampNarrateLine — non-string / nullish → "" =====================
eq(clampNarrateLine(123), "", "number → ''");
eq(clampNarrateLine(null), "", "null → ''");
eq(clampNarrateLine(undefined), "", "undefined → ''");
eq(clampNarrateLine({}), "", "object → '' (never '[object Object]')");
eq(clampNarrateLine(["a"]), "", "array → ''");
eq(clampNarrateLine(true), "", "boolean → ''");
eq(clampNarrateLine(""), "", "empty string → ''");
eq(clampNarrateLine("   \n\t  "), "", "whitespace-only → ''");

// ===================== clampNarrateLine — trimming / whitespace collapse =====================
eq(clampNarrateLine("  hello world  "), "hello world", "outer whitespace trimmed");
eq(clampNarrateLine("line1\nline2\n\nline3"), "line1 line2 line3", "newlines collapse to single spaces");
eq(clampNarrateLine("a\tb   c"), "a b c", "tabs + runs of spaces collapse");

// ===================== clampNarrateLine — code fences / fence tokens =====================
eq(clampNarrateLine("```js\nconst x = 1;\n```"), "const x = 1;", "fenced code block stripped to its body");
eq(clampNarrateLine("```\n```"), "", "empty code fence → ''");
eq(clampNarrateLine("text <<<FENCE>>> more"), "text FENCE more", "stray <<< >>> fence tokens removed");

// ===================== clampNarrateLine — markdown emphasis / heading / quote / list markers =====================
eq(clampNarrateLine("**bold** _em_ `co` ~s~ # H > q"), "bold em co s H q", "*, _, `, ~, #, > markers stripped");
eq(clampNarrateLine("# Heading"), "Heading", "leading heading marker removed");
eq(clampNarrateLine("issue #42 blocked"), "issue 42 blocked", "mid-text # stripped (markdown normalization)");
eq(clampNarrateLine("- first\n- second"), "first second", "leading '-' bullet markers removed");
eq(clampNarrateLine("• bullet point"), "bullet point", "leading '•' bullet marker removed");

// ===================== clampNarrateLine — surrounding-quote strip (only edges) =====================
eq(clampNarrateLine('"quoted text"'), "quoted text", "straight double quotes stripped from edges");
eq(clampNarrateLine("'single quoted'"), "single quoted", "straight single quotes stripped from edges");
eq(clampNarrateLine("“curly quoted”"), "curly quoted", "curly quotes stripped from edges");
eq(clampNarrateLine('""double wrapped""'), "double wrapped", "repeated edge quotes all stripped");
eq(clampNarrateLine('say "hi" there'), 'say "hi" there', "INTERNAL quotes preserved (only edges stripped)");

// ===================== clampNarrateLine — length clamp (+ ellipsis) =====================
const c500 = clampNarrateLine("a".repeat(500));
ok(c500.length === 360 && c500.endsWith("…"), "500 chars clamp to default cap 360 with ellipsis");
const c50 = clampNarrateLine("b".repeat(200), 50);
ok(c50.length === 50 && c50.endsWith("…"), "custom cap 50 respected (length 50, ellipsis)");
eq(clampNarrateLine("short", 100), "short", "under cap → unchanged, no ellipsis");
const cExact = clampNarrateLine("c".repeat(50), 50);
ok(cExact === "c".repeat(50) && !cExact.endsWith("…"), "exactly at cap → NOT clamped (no ellipsis)");
ok(clampNarrateLine("d".repeat(1000)).length <= 360, "output length never exceeds cap");

// ===================== clampNarrateLine — combined pathological input =====================
eq(clampNarrateLine('  "```json\n**Result** <<<X>>>\n```"  '), "Result X",
  "fence+markdown+injection-token+quotes all sanitized together");

// ===================== buildDryRunFacts — non-array → "" =====================
eq(buildDryRunFacts(null), "", "null changes → ''");
eq(buildDryRunFacts(undefined), "", "undefined changes → ''");
eq(buildDryRunFacts("nope"), "", "string changes → ''");
eq(buildDryRunFacts({}), "", "object changes → ''");
eq(buildDryRunFacts([]), "", "empty array → ''");

// ===================== buildDryRunFacts — per-action templates =====================
eq(buildDryRunFacts([{ action: "updateIssue", key: "PROJ-1", fields: { summary: "Hi" } }]),
  'Update PROJ-1 fields: {"summary":"Hi"}', "updateIssue templated");
eq(buildDryRunFacts([{ action: "updateIssue", fields: { a: 1 } }]),
  'Update the issue fields: {"a":1}', "updateIssue missing key → 'the issue'");
ok(buildDryRunFacts([{ action: "editIssue", key: "E-1", update: { x: 1 } }]).startsWith("Edit E-1:"),
  "editIssue templated");
eq(buildDryRunFacts([{ action: "transitionIssue", key: "T-1", transitionId: 31 }]),
  "Transition T-1 (transition id 31)", "transitionIssue templated (numeric id stringified)");
ok(buildDryRunFacts([{ action: "addLabels", key: "L-1", labels: ["bug", "urgent"] }])
  .includes('["bug","urgent"]'), "addLabels includes label array");
ok(buildDryRunFacts([{ action: "removeLabels", key: "L-1", labels: ["old"] }])
  .startsWith("Remove labels from L-1:"), "removeLabels templated");
eq(buildDryRunFacts([{ action: "addComment", key: "C-1" }]), "Add a comment to C-1", "addComment templated");
eq(buildDryRunFacts([{ action: "addComment" }]), "Add a comment to the issue", "addComment missing key");
eq(buildDryRunFacts([{ action: "createIssueLink", from: "A-1", to: "B-2", type: "blocks" }]),
  "Link A-1 to B-2 (blocks)", "createIssueLink templated");
eq(buildDryRunFacts([{ action: "createIssueLink" }]), "Link the issue to another issue ()",
  "createIssueLink all-missing → fallbacks");
eq(buildDryRunFacts([{ action: "createIssue", fields: { project: "P" } }]),
  'Create a new issue: {"project":"P"}', "createIssue templated");
eq(buildDryRunFacts([{ action: "cloneIssue" }]), "Clone the issue", "cloneIssue without overrides");
eq(buildDryRunFacts([{ action: "cloneIssue", overrides: { summary: "X" } }]),
  'Clone the issue with overrides: {"summary":"X"}', "cloneIssue with overrides");
eq(buildDryRunFacts([{ action: "setProperty", key: "S-1", propKey: "my.prop" }]),
  'Set property "my.prop" on S-1', "setProperty templated");

// ===================== buildDryRunFacts — generic fallback (unknown / missing action) =====================
eq(buildDryRunFacts([{ action: "addWorklog", timeSpent: "1h", key: "X-1" }]),
  "addWorklog (timeSpent=1h, key=X-1)", "unknown action → generic 'action (k=v, ...)' fallback");
eq(buildDryRunFacts([{ foo: "bar" }]), "change (foo=bar)", "missing action → 'change' + fields");
eq(buildDryRunFacts([{ action: "" }]), "change", "empty-string action coerced to 'change' (no extra fields)");

// ===================== buildDryRunFacts — value truncation + whitespace collapse =====================
const longVal = buildDryRunFacts([{ action: "updateIssue", key: "K-1", fields: "z".repeat(300) }]);
ok(longVal.endsWith("…"), "over-long field value truncated with ellipsis (140-char cap)");
ok(longVal.length < 200, "single change with truncated value stays bounded");
eq(buildDryRunFacts([{ action: "updateIssue", key: "K-1", fields: "a\nb\t c   d" }]),
  "Update K-1 fields: a b c d", "field value whitespace/newlines collapse to single spaces");
ok(buildDryRunFacts([{ action: "transitionIssue", key: "T-1", transitionId: "T".repeat(60) }])
  .includes("…"), "transitionId truncated at 40 with ellipsis");

// ===================== buildDryRunFacts — caps (40 changes, 4000 chars) =====================
const many = [];
for (let i = 0; i < 45; i++) many.push({ action: "addComment", key: `C-${i}` });
eq(buildDryRunFacts(many).split("\n").length, 40, "capped at 40 changes");
const huge = [];
for (let i = 0; i < 40; i++) huge.push({ action: "updateIssue", key: "K", fields: "z".repeat(300) });
eq(buildDryRunFacts(huge).length, 4000, "total output hard-capped at 4000 chars");

// ===================== countChangeVerbs =====================
const cv = countChangeVerbs([{ action: "updateIssue" }, { action: "updateIssue" }, { action: "addComment" }]);
ok(cv.updateIssue === 2 && cv.addComment === 1, "counts per action verb");
eq(Object.keys(countChangeVerbs(null)).length, 0, "non-array → {}");
eq(Object.keys(countChangeVerbs("x")).length, 0, "string → {}");
const cvFallback = countChangeVerbs([null, {}, { action: "x" }]);
ok(cvFallback.change === 2 && cvFallback.x === 1, "null entry + missing action → 'change'; known action counted");
eq(countChangeVerbs([{ action: "" }]).change, 1, "empty-string action counted as 'change' (matches buildDryRunFacts)");

// ===================== CHANGE_VERB_LABEL =====================
eq(CHANGE_VERB_LABEL.updateIssue, "Update fields", "label: updateIssue");
eq(CHANGE_VERB_LABEL.transitionIssue, "Transition", "label: transitionIssue");
eq(CHANGE_VERB_LABEL.setProperty, "Set property", "label: setProperty");
eq(CHANGE_VERB_LABEL.createIssueLink, "Link issue", "label: createIssueLink");
eq(Object.keys(CHANGE_VERB_LABEL).length, 10, "10 known change-verb labels");

console.log(`\nnarrate-utils: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
