/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Offline unit test for src/memories.js: buildMemoryBlock (prompt-injection block builder),
// getMemorySettings (default + coercion), and the saveMemories / pruneOne overflow guards
// (item cap + serialized-byte cap, auto-before-user eviction, pruneScore + updatedAt tie-break).
// Uses the mock @forge/kvs. Run:
//   node --import ../lib/register-mocks.mjs scripts/memory-block.test.mjs
import storage from "../lib/mock-kvs.mjs";
import {
  buildMemoryBlock, getMemorySettings, saveMemories, saveMemorySettingsInternal,
  MEMORIES_KEY, MEMORY_SETTINGS_KEY,
} from "../../src/memories.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const seed = (arr) => { storage.__reset(); storage.__seed(MEMORIES_KEY, arr); };
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
// Full memory row with sane defaults so buildMemoryBlock's filter/sort see real fields.
const mk = (o) => ({
  id: o.id, content: o.content, source: o.source || "user",
  projectKey: o.projectKey ?? null, confidence: o.confidence ?? 0.5,
  reinforcements: o.reinforcements ?? 0, disabled: o.disabled ?? false,
  createdAt: o.updatedAt || "2026-01-01T00:00:00Z", updatedAt: o.updatedAt || "2026-01-01T00:00:00Z",
});

// ===================== buildMemoryBlock — filter =====================

// disabled excluded even when it would sort first (highest confidence)
seed([
  mk({ id: "dis", content: "DISABLEDHI", confidence: 0.99, disabled: true }),
  mk({ id: "en", content: "ENABLEDLO", confidence: 0.1, disabled: false }),
]);
let b = await buildMemoryBlock({});
ok(!b.text.includes("DISABLEDHI"), "disabled memory is excluded from the block");
ok(b.text.includes("ENABLEDLO") && b.count === 1, "enabled memory included; count reflects only eligible");

// empty store → empty block
seed([]);
b = await buildMemoryBlock({});
ok(b.text === "" && b.count === 0, "no eligible memories → { text: '', count: 0 }");

// project filter: scoped-to-other-project excluded; unscoped + scoped-to-P included for projectKey P
seed([
  mk({ id: "un", content: "UNSCOPEDHI", confidence: 0.95, projectKey: null }),
  mk({ id: "sc", content: "SCOPEDLO", confidence: 0.1, projectKey: "P" }),
  mk({ id: "other", content: "OTHERPROJ", confidence: 0.99, projectKey: "Q" }),
]);
b = await buildMemoryBlock({ projectKey: "P" });
ok(!b.text.includes("OTHERPROJ"), "memory scoped to a DIFFERENT project is excluded");
ok(b.text.includes("SCOPEDLO") && b.text.includes("UNSCOPEDHI") && b.count === 2, "unscoped + same-project scoped are included");
// with no project context, ONLY unscoped survive (both scoped rows drop)
b = await buildMemoryBlock({});
ok(b.text.includes("UNSCOPEDHI") && !b.text.includes("SCOPEDLO") && !b.text.includes("OTHERPROJ") && b.count === 1,
  "null projectKey → only unscoped memories are eligible");

// ===================== buildMemoryBlock — ordering =====================

// project-scoped sorts BEFORE unscoped regardless of confidence
b = (seed([
  mk({ id: "un", content: "UNSCOPEDHI", confidence: 0.95, projectKey: null }),
  mk({ id: "sc", content: "SCOPEDLO", confidence: 0.1, projectKey: "P" }),
]), await buildMemoryBlock({ projectKey: "P" }));
ok(b.text.indexOf("SCOPEDLO") < b.text.indexOf("UNSCOPEDHI"),
  "project-scoped memory sorts first even with lower confidence");

// within a group: confidence desc, then reinforcements desc
seed([
  mk({ id: "c5r0", content: "CONF5R0", confidence: 0.5, reinforcements: 0 }),
  mk({ id: "c9", content: "CONF9", confidence: 0.9, reinforcements: 0 }),
  mk({ id: "c5r3", content: "CONF5R3", confidence: 0.5, reinforcements: 3 }),
]);
b = await buildMemoryBlock({});
ok(b.text.indexOf("CONF9") < b.text.indexOf("CONF5R3"), "higher confidence sorts first");
ok(b.text.indexOf("CONF5R3") < b.text.indexOf("CONF5R0"), "equal confidence → higher reinforcements sorts first");

// tie-break on updatedAt desc (newer first) when confidence + reinforcements equal
seed([
  mk({ id: "u_old", content: "UPDOLD", confidence: 0.5, reinforcements: 0, updatedAt: "2026-01-01T00:00:00Z" }),
  mk({ id: "u_new", content: "UPDNEW", confidence: 0.5, reinforcements: 0, updatedAt: "2026-06-01T00:00:00Z" }),
]);
b = await buildMemoryBlock({});
ok(b.text.indexOf("UPDNEW") < b.text.indexOf("UPDOLD"), "final tie-break: newer updatedAt sorts first");

// ===================== buildMemoryBlock — formatting =====================

// line shape "- [source] content"; missing source defaults to "user"
seed([mk({ id: "ns", content: "NOSOURCE", source: undefined }), mk({ id: "ts", content: "TESTSRC", source: "test", confidence: 0.4 })]);
b = await buildMemoryBlock({});
ok(b.text.includes("- [user] NOSOURCE"), "missing source renders as [user]");
ok(b.text.includes("- [test] TESTSRC"), "explicit source is rendered in the tag");

// defang: untrusted fence tokens in content are neutralised (<<< -> <<, >>> -> >>)
seed([mk({ id: "d", content: "use <<<FENCE>>> and <<<< raw" })]);
b = await buildMemoryBlock({});
ok(!b.text.includes("<<<") && !b.text.includes(">>>"), "content fence tokens are defanged (no literal <<< or >>>)");
ok(b.text.includes("<<FENCE>>"), "defang collapses <<<FENCE>>> to <<FENCE>>");

// ===================== buildMemoryBlock — capBytes (whole lines, never exceeds) =====================

// three 20-char contents; each line is "- [user] " (9) + 20 = 29 chars.
seed([
  mk({ id: "A", content: "A".repeat(20), confidence: 0.9 }),
  mk({ id: "B", content: "B".repeat(20), confidence: 0.8 }),
  mk({ id: "C", content: "C".repeat(20), confidence: 0.7 }),
]);
// cap 70: line1 (29) + "\n" + line2 (29) = 59 fits; adding line3 (89) would exceed → stop at 2.
b = await buildMemoryBlock({ capBytes: 70 });
ok(b.count === 2 && b.text.length === 59, "capBytes 70 fits exactly 2 whole lines (59 chars)");
ok(b.text.length <= 70, "block never exceeds capBytes");
ok(b.text.includes("A".repeat(20)) && b.text.includes("B".repeat(20)) && !b.text.includes("C".repeat(20)),
  "retained lines are the highest-priority prefix; the overflow line is dropped whole");
// cap 40: only the first line (29) fits, second would make 59 > 40.
b = await buildMemoryBlock({ capBytes: 40 });
ok(b.count === 1 && b.text.length === 29 && b.text.length <= 40, "capBytes 40 → exactly 1 whole line");
// cap smaller than a single line → nothing fits, empty (never partial)
b = await buildMemoryBlock({ capBytes: 5 });
ok(b.count === 0 && b.text === "", "capBytes below one line → empty block (no partial line)");
// generous default cap fits everything
b = await buildMemoryBlock({});
ok(b.count === 3, "default cap (8192) admits all three lines");

// ===================== getMemorySettings =====================

// unset → documented defaults
storage.__reset();
let s = await getMemorySettings();
ok(s.autoCapture === false && s.injection === true && s.runtimeInjection === false,
  "unset settings → { autoCapture:false, injection:true, runtimeInjection:false }");

// fully-set values returned
storage.__reset();
storage.__seed(MEMORY_SETTINGS_KEY, { autoCapture: true, injection: false, runtimeInjection: true });
s = await getMemorySettings();
ok(s.autoCapture === true && s.injection === false && s.runtimeInjection === true, "stored settings are returned verbatim");

// strict boolean coercion: autoCapture/runtimeInjection require === true; injection is !== false
storage.__reset();
storage.__seed(MEMORY_SETTINGS_KEY, { autoCapture: "yes", injection: 0, runtimeInjection: 1 });
s = await getMemorySettings();
ok(s.autoCapture === false, "autoCapture truthy-but-not-true string coerces to false");
ok(s.injection === true, "injection = (0 !== false) coerces to true (only literal false disables)");
ok(s.runtimeInjection === false, "runtimeInjection numeric 1 (not === true) coerces to false");

// partial patch: absent keys fall back to their defaults (injection defaults ON)
storage.__reset();
storage.__seed(MEMORY_SETTINGS_KEY, { autoCapture: true });
s = await getMemorySettings();
ok(s.autoCapture === true && s.injection === true && s.runtimeInjection === false, "partial stored object → missing keys use defaults");

// non-object stored value → defaults (guarded)
storage.__reset();
storage.__seed(MEMORY_SETTINGS_KEY, "true");
s = await getMemorySettings();
ok(s.autoCapture === false && s.injection === true && s.runtimeInjection === false, "non-object stored value falls back to defaults");

// round-trip through saveMemorySettingsInternal merge
storage.__reset();
await saveMemorySettingsInternal({ runtimeInjection: true });
s = await getMemorySettings();
ok(s.runtimeInjection === true && s.injection === true && s.autoCapture === false, "saveMemorySettingsInternal merges a single-key patch");

// ===================== saveMemories — item cap (200) =====================

// 206 auto + 1 user → pruned to the 200 cap; the user memory survives (autos evicted first)
{
  const arr = [];
  for (let i = 0; i < 206; i++) arr.push(mk({ id: `a${i}`, content: `auto ${i}`, source: "test", confidence: 0.5 }));
  arr.push(mk({ id: "keepUser", content: "user memory", source: "user", confidence: 0.01 }));
  const out = await saveMemories(arr);
  ok(out.length === 200, `over-cap array pruned to 200 (was ${arr.length}, now ${out.length})`);
  ok(out.some((m) => m.id === "keepUser"), "low-confidence USER memory survives the item-cap prune (autos go first)");
}

// ===================== saveMemories — pruneOne selection =====================

// exactly 1 over cap → evicts the single lowest pruneScore auto (lowest confidence)
{
  const arr = [];
  for (let i = 0; i < 200; i++) arr.push(mk({ id: `hi${i}`, content: `hi ${i}`, source: "test", confidence: 0.9 }));
  arr.push(mk({ id: "victim", content: "lowest score", source: "test", confidence: 0.05 }));
  const out = await saveMemories(arr); // 201 → 200
  ok(out.length === 200 && !out.some((m) => m.id === "victim"), "single overflow evicts the lowest-pruneScore entry");
}

// pruneScore weights reinforcements: a low-confidence but heavily-reinforced entry outranks a higher-raw-confidence one
{
  const arr = [];
  for (let i = 0; i < 199; i++) arr.push(mk({ id: `f${i}`, content: `f ${i}`, source: "test", confidence: 0.5 }));
  arr.push(mk({ id: "reinf5", content: "reinforced", source: "test", confidence: 0.1, reinforcements: 5 })); // score 0.1 + 0.5 = 0.6
  arr.push(mk({ id: "raw02", content: "raw conf", source: "test", confidence: 0.2, reinforcements: 0 }));     // score 0.2
  const out = await saveMemories(arr); // 201 → 200, evict lowest = raw02
  ok(!out.some((m) => m.id === "raw02"), "raw02 (score 0.2) is evicted");
  ok(out.some((m) => m.id === "reinf5"), "reinf5 survives — reinforcements lift pruneScore above raw confidence");
}

// tie-break: equal pruneScore → OLDEST updatedAt evicted first
{
  const arr = [];
  for (let i = 0; i < 199; i++) arr.push(mk({ id: `f${i}`, content: `f ${i}`, source: "test", confidence: 0.9 }));
  arr.push(mk({ id: "lowOld", content: "old low", source: "test", confidence: 0.1, updatedAt: "2026-01-01T00:00:00Z" }));
  arr.push(mk({ id: "lowNew", content: "new low", source: "test", confidence: 0.1, updatedAt: "2026-06-01T00:00:00Z" }));
  const out = await saveMemories(arr); // 201 → 200, both low tie on score 0.1; evict older
  ok(!out.some((m) => m.id === "lowOld"), "on a pruneScore tie the OLDER updatedAt is evicted");
  ok(out.some((m) => m.id === "lowNew"), "the newer of two tied low-score entries survives");
}

// ===================== saveMemories — serialized-byte cap (230000) =====================

// 30 fat auto rows + 2 fat user rows blow past the byte cap → prune by size until under; users survive.
{
  const fat = "x".repeat(9000);
  const arr = [];
  for (let i = 0; i < 30; i++) arr.push(mk({ id: `big${i}`, content: `${i} ${fat}`, source: "test", confidence: 0.5 }));
  arr.splice(5, 0, mk({ id: "userA", content: `A ${fat}`, source: "user", confidence: 0.5 }));
  arr.splice(20, 0, mk({ id: "userB", content: `B ${fat}`, source: "user", confidence: 0.5 }));
  ok(bytes(arr) >= 230000, `pre-prune array exceeds the byte cap (${bytes(arr)} bytes)`);
  const out = await saveMemories(arr);
  ok(bytes(out) < 230000, `serialized size guard prunes below the cap (${bytes(out)} bytes)`);
  ok(out.length < arr.length, `size guard evicted rows (${arr.length} → ${out.length})`);
  ok(out.some((m) => m.id === "userA") && out.some((m) => m.id === "userB"),
    "both USER memories survive the size-based prune (auto rows evicted first)");
}

console.log(`\nmemory-block: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
