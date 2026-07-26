/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for the SKILL auto-match scorer (src/skills.js autoMatchSkills) — a pure function the
// caller feeds a skill index. Covers the audit's TEST BACKLOG item: +3 per fully-matched tag, +1 per
// distinct name/desc token, +2 for a declared operationType, threshold >= 3, STOPWORDS, hyphenated-tag AND
// semantics, excludeIds, enabled gate, max cap, and score-desc order. (autoMatchSkills takes the index as an
// argument, so no @forge/kvs is exercised — the module import resolves offline.) Run:
//   node test-harness/scripts/skills-scorer.test.mjs
import { autoMatchSkills } from "../../src/skills.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const ids = (arr) => (arr || []).map((s) => s.id);
const mk = (id, name, description, tags, operationTypes = [], enabled = true) => ({ id, name, description, tags, operationTypes, enabled });

// --- a fully-matched TAG scores +3 and reaches threshold ---
const idxTag = [mk("s-cmt", "", "", ["comment"])];
ok(ids(autoMatchSkills("add a comment to the issue", null, idxTag)).includes("s-cmt"), "single fully-matched tag (+3) matches");

// --- HYPHENATED tag = AND semantics (all sub-tokens must be present) ---
const idxHyphen = [mk("s-link", "", "", ["issue-link"])];
ok(ids(autoMatchSkills("please link the issue", null, idxHyphen)).includes("s-link"), "hyphenated tag issue-link matches when BOTH issue+link present");
ok(!ids(autoMatchSkills("please link something else", null, idxHyphen)).includes("s-link"), "hyphenated tag does NOT match when only 'link' present (AND semantics)");

// --- operationType alone (+2) is BELOW threshold → must NOT match ---
const idxOpOnly = [mk("s-op", "", "", ["zzzznotoken"], ["update-field"])];
ok(autoMatchSkills("write the target value now", "update-field", idxOpOnly).length === 0, "operationType-only (+2) is below threshold 3 → no match");
// opType (+2) + one name/desc token (+1) = 3 → matches
const idxOpPlus = [mk("s-op2", "target", "", ["zzzznotoken"], ["update-field"])];
ok(ids(autoMatchSkills("write the target value", "update-field", idxOpPlus)).includes("s-op2"), "operationType (+2) + 1 name token (+1) = 3 → matches");

// --- name/description tokens score +1 each (distinct) — 3 distinct hits reach threshold w/o any tag ---
const idxND = [mk("s-nd", "release deployment pipeline", "", [])];
ok(ids(autoMatchSkills("our release deployment pipeline", null, idxND)).includes("s-nd"), "3 distinct name tokens (+1 each) reach threshold");
ok(autoMatchSkills("our release deployment", null, idxND).length === 0, "only 2 name tokens (+2) is below threshold");

// --- STOPWORDS + tiny tokens are filtered ---
ok(autoMatchSkills("the and to of it is", null, idxTag).length === 0, "an all-stopword prompt yields no tokens → no matches");
ok(autoMatchSkills("", null, idxTag).length === 0, "empty prompt → []");
ok(autoMatchSkills("   ", null, idxTag).length === 0, "whitespace prompt → []");

// --- excludeIds + enabled gate ---
ok(autoMatchSkills("add a comment", null, idxTag, { excludeIds: ["s-cmt"] }).length === 0, "excludeIds removes a matching skill");
ok(autoMatchSkills("add a comment", null, [mk("s-cmt", "", "", ["comment"], [], false)]).length === 0, "enabled:false skill is skipped");

// --- max cap + score-desc order ---
const idxMany = [
  mk("hi", "", "", ["comment"], ["update-field"]),      // +3 tag +2 op = 5
  mk("mid", "", "", ["comment"]),                        // +3
  mk("lo", "comment note", "", []),                      // name 'comment' +1 ... only +1 → below threshold (excluded)
];
const top = autoMatchSkills("add a comment", "update-field", idxMany, { max: 2 });
ok(top.length === 2, "respects max cap (2)");
ok(top[0].id === "hi" && top[1].id === "mid", "returns highest-scoring first (5 before 3); sub-threshold 'lo' excluded");
ok(!ids(top).includes("lo"), "a skill scoring only +1 is below threshold and excluded");

console.log(`\nskills-scorer: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
