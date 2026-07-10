/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Offline unit test for memory DEDUP / REINFORCE / PRUNE (src/memories.js) via the mock @forge/kvs.
// Run: node --import ../lib/register-mocks.mjs scripts/memory-dedup.test.mjs   (see test:offline)
// Covers: normalizeMemoryText masking, exact + Jaccard dedup, reinforce (reinforcements++, confidence=max),
// prune (auto evicted before user, 200-item cap), and the audit's PLAUSIBLE "reinforce a DISABLED memory
// without re-enabling" — a USER re-add of an archived memory must re-enable it (else it's a silent no-op);
// an AUTO reinforce must NOT resurrect an admin's archive.
import storage from "../lib/mock-kvs.mjs";
import {
  saveMemoryCandidate, normalizeMemoryText, buildMemoryBlock, MEMORIES_KEY,
} from "../../src/memories.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const reset = (seed = []) => { storage.__reset(); storage.__seed(MEMORIES_KEY, seed); };
const load = () => storage.__raw(MEMORIES_KEY) || [];

// --- normalizeMemoryText: mask issue keys + long numbers, lowercase, collapse ws ---
ok(normalizeMemoryText("ABC-123 failed on 2026 with 40404") === normalizeMemoryText("XYZ-999 failed on 1998 with 55555"),
  "issue-key (UPPER-\\d) + 4+digit runs mask so two failures differing only in ids normalize equal");
ok(normalizeMemoryText("  Multiple   spaces here ") === "multiple spaces here", "lowercases + collapses whitespace");

// --- new memory, then EXACT-normalized dedup reinforces (no near-duplicate) ---
reset([]);
const a = await saveMemoryCandidate({ content: "The Rollback field customfield_10099 is required on release", source: "user", confidence: 0.6 });
ok(a.merged === false && load().length === 1, "first add creates one memory");
const b = await saveMemoryCandidate({ content: "the ROLLBACK field   customfield_10099 is REQUIRED on release", source: "test", confidence: 0.9 });
ok(b.merged === true && load().length === 1, "exact-normalized re-add reinforces (no duplicate)");
ok(load()[0].reinforcements === 1, "reinforcements incremented");
ok(load()[0].confidence === 0.9, "confidence = max(existing, candidate)");

// --- Jaccard >= 0.85 reinforces; a dissimilar memory is a NEW entry ---
reset([]);
await saveMemoryCandidate({ content: "always set the fix version before closing the bug", source: "user" });
const jac = await saveMemoryCandidate({ content: "always set the fix version before closing the bug now", source: "user" });
ok(jac.merged === true && load().length === 1, "near-identical (Jaccard >= 0.85, superset by one token) reinforces");
const diff = await saveMemoryCandidate({ content: "sprint velocity should exclude spillover stories", source: "user" });
ok(diff.merged === false && load().length === 2, "a dissimilar memory is added as new");

// --- THE BUG: a USER re-add of a DISABLED memory must RE-ENABLE it (else silent no-op / invisible) ---
reset([{ id: "m1", content: "the login retry needs exponential backoff", source: "user", confidence: 1, reinforcements: 0, disabled: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }]);
const re = await saveMemoryCandidate({ content: "the login retry needs exponential backoff", source: "user" });
ok(re.merged === true, "user re-add of an archived memory dedups to it");
ok(load()[0].disabled === false, "USER re-add RE-ENABLES the archived memory (not a silent no-op)");
const block = await buildMemoryBlock({});
ok(block.text.includes("login retry"), "the re-enabled memory is now injected (buildMemoryBlock)");

// --- an AUTO (test/fix) reinforce must NOT resurrect an admin's archive ---
reset([{ id: "m2", content: "disable the flaky integration webhook", source: "fix", confidence: 1, reinforcements: 0, disabled: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }]);
await saveMemoryCandidate({ content: "disable the flaky integration webhook", source: "fix" });
ok(load()[0].disabled === true, "AUTO reinforce does NOT re-enable an archived memory (respects the admin's disable)");

// --- prune: over the 200 cap, AUTO memories are evicted before USER memories ---
reset([]);
const big = [];
for (let i = 0; i < 205; i++) big.push({ id: `auto${i}`, content: `auto lesson number ${i} distinct`, source: "test", confidence: 0.1, reinforcements: 0, disabled: false, updatedAt: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z` });
big.unshift({ id: "keepUser", content: "a user memory that must survive pruning", source: "user", confidence: 0.05, reinforcements: 0, disabled: false, updatedAt: "2026-01-01T00:00:00Z" });
storage.__seed(MEMORIES_KEY, big);
await saveMemoryCandidate({ content: "a brand new distinct auto lesson zzz", source: "test" });
const after = load();
ok(after.length <= 200, `pruned to the 200 cap (was 206, now ${after.length})`);
ok(after.some((m) => m.id === "keepUser"), "the low-confidence USER memory survived (auto pruned first)");

console.log(`\nmemory-dedup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
