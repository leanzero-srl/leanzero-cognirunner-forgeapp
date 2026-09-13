/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for memory DEDUP / REINFORCE / PRUNE (src/memories.js) via the mock @forge/kvs.
// Run: node --import ../lib/register-mocks.mjs scripts/memory-dedup.test.mjs   (see test:offline)
// Covers: normalizeMemoryText masking, exact + Jaccard dedup, reinforce (reinforcements++, confidence=max),
// prune (ONLY auto rows are ever evicted — F-164: a hand-authored memory is never evicted by the app,
// a user add at an all-user cap is refused instead; 200-item cap), and the audit's PLAUSIBLE "reinforce a DISABLED memory
// without re-enabling" — a USER re-add of an archived memory must re-enable it (else it's a silent no-op);
// an AUTO reinforce must NOT resurrect an admin's archive.
import storage from "../lib/mock-kvs.mjs";
import {
  saveMemoryCandidate, normalizeMemoryText, buildMemoryBlock, pruneForSave, MEMORIES_KEY, MAX_MEMORIES,
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

// --- SCOPE WIDENS ON MERGE (dedup matches on TEXT; the merged memory's scope becomes the UNION). ---
// A fact re-learned in a DIFFERENT project — or a GLOBAL fact meeting a project-scoped one — promotes
// the memory to GLOBAL (null = broadest), so scope only ever WIDENS, never narrows. Same-project re-adds
// keep their scope. (Implemented in saveMemoryCandidate; fixes the old scope-blind narrowing.)
// (1) cross-project candidate (PROJB) merges into a PROJA memory → promotes to GLOBAL → BOTH projects see it.
reset([{ id: "pa", content: "the deploy gate needs a QA signoff", source: "user", projectKey: "PROJA", confidence: 0.5, reinforcements: 0, disabled: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }]);
const xProj = await saveMemoryCandidate({ content: "the deploy gate needs a QA signoff", source: "test", projectKey: "PROJB" });
ok(xProj.merged === true && load().length === 1, "cross-project candidate (PROJB) merges into the existing PROJA memory — one memory, no duplicate");
ok(load()[0].projectKey === null, "the merged memory WIDENS to GLOBAL (seen in 2 projects) — no longer stuck on PROJA");
ok(load()[0].reinforcements === 1, "cross-project match still reinforces");
const blkB = await buildMemoryBlock({ projectKey: "PROJB" });
ok(blkB.text.includes("QA signoff"), "CONSEQUENCE FIXED: PROJB now DOES get the merged memory injected (widened to global)");
const blkA = await buildMemoryBlock({ projectKey: "PROJA" });
ok(blkA.text.includes("QA signoff"), "PROJA still gets it too");
// (2) a GLOBAL candidate merging into a project-scoped memory WIDENS it back to global (worst-case fixed).
reset([{ id: "pa2", content: "close stale bugs after ninety days", source: "user", projectKey: "PROJA", confidence: 0.5, reinforcements: 0, disabled: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }]);
const gCand = await saveMemoryCandidate({ content: "close stale bugs after ninety days", source: "user", projectKey: null });
ok(gCand.merged === true && load()[0].projectKey === null, "a GLOBAL candidate merging into a PROJA memory WIDENS it to global — the fact is injected everywhere (no longer narrowed)");
// (3) a project candidate merging into a GLOBAL memory keeps it GLOBAL (already broadest).
reset([{ id: "g1", content: "prefer squash merges on the main branch", source: "user", projectKey: null, confidence: 0.5, reinforcements: 0, disabled: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }]);
const aCand = await saveMemoryCandidate({ content: "prefer squash merges on the main branch", source: "user", projectKey: "PROJA" });
ok(aCand.merged === true && load()[0].projectKey === null, "a PROJA candidate merging into a GLOBAL memory keeps it GLOBAL (already broadest)");
// (4) a same-project re-add KEEPS its project scope (widen only fires on a scope MISMATCH).
reset([{ id: "sp", content: "the sprint field is customfield mapped per board", source: "user", projectKey: "PROJA", confidence: 0.5, reinforcements: 0, disabled: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }]);
const sameProj = await saveMemoryCandidate({ content: "the sprint field is customfield mapped per board", source: "user", projectKey: "PROJA" });
ok(sameProj.merged === true && load()[0].projectKey === "PROJA", "a SAME-project (PROJA→PROJA) re-add keeps projectKey PROJA — scope only widens on a mismatch");

// --- CHARACTERIZATION: normalizeMemoryText masks 4+ digit runs to "N", so two memories about ---
// DIFFERENT customfield ids collapse in dedup and the second merges into the first (its distinct id
// is dropped). This is the DOCUMENTED anti-bloat trade-off (normalizeMemoryText docstring 92-97) and
// the it80 finding #8 (characterize-only). Locked here so any future change is a deliberate red->green
// edit. Asserts what the code does today, not that it's necessarily desired.
reset([]);
const cf1 = await saveMemoryCandidate({ content: "the Rollout field customfield_10040 is required on release", source: "user" });
ok(cf1.merged === false && load().length === 1, "first customfield memory is created");
const cf2 = await saveMemoryCandidate({ content: "the Rollout field customfield_10099 is required on release", source: "user" });
ok(cf2.merged === true && load().length === 1, "a memory about a DIFFERENT customfield id (10099 vs 10040) collapses via digit-masking dedup — no second memory created");
ok(load()[0].content.includes("10040") && !load()[0].content.includes("10099"), "the surviving memory keeps the FIRST id; the distinct second id is dropped (documented digit-mask trade-off)");

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

// --- F-160: the SAME assertion against an ALL-USER store, where it actually bites.
// Before F-160 the auto pool came out empty and the lowest-scoring USER row was the
// victim — a machine lesson evicting a human's memory. Policy: an auto candidate NEVER
// evicts a user memory; with no other auto row it is simply not stored.
reset([]);
const allUser = [];
for (let i = 0; i < 200; i++) allUser.push({ id: `u${i}`, content: `a user lesson number ${i} distinct`, source: "user", confidence: i === 0 ? 0.05 : 1.0, reinforcements: i === 0 ? 0 : 5, disabled: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z` });
storage.__seed(MEMORIES_KEY, allUser);
const beforeJson = JSON.stringify(load());
const autoAtCap = await saveMemoryCandidate({ content: "a novel fix lesson about webhook retry backoff", source: "fix", confidence: 0.2 });
ok(autoAtCap.stored === false && autoAtCap.id === null && autoAtCap.reason === "cap",
  `an AUTO candidate at an all-user cap is REJECTED with reason 'cap' (got ${JSON.stringify({ stored: autoAtCap.stored, reason: autoAtCap.reason })})`);
ok(JSON.stringify(load()) === beforeJson, "the rejected auto candidate leaves the store BYTE-IDENTICAL (no collateral eviction)");
ok(load().some((m) => m.id === "u0"), "the lowest-scoring USER memory (0.05 conf) was NOT evicted by an auto candidate");

// --- F-160: a MIXED store at the cap — the auto candidate IS stored, and the victim is an AUTO row ---
reset([]);
const mixed = [];
for (let i = 0; i < 190; i++) mixed.push({ id: `mu${i}`, content: `a user lesson number ${i} distinct`, source: "user", confidence: 0.05, reinforcements: 0, disabled: false, updatedAt: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z` });
for (let i = 0; i < 10; i++) mixed.push({ id: `ma${i}`, content: `an auto lesson number ${i} distinct`, source: "test", confidence: 0.9, reinforcements: 5, disabled: false, updatedAt: `2026-02-01T00:00:${String(i % 60).padStart(2, "0")}Z` });
storage.__seed(MEMORIES_KEY, mixed);
const mixedAdd = await saveMemoryCandidate({ content: "a novel fix lesson about sprint field mapping", source: "fix", confidence: 0.2 });
const mixedAfter = load();
ok(mixedAdd.stored === true && mixedAfter.some((m) => m.id === mixedAdd.id), "at a MIXED cap the auto candidate IS stored");
ok(mixedAfter.length === 200, `store stays at the cap (${mixedAfter.length})`);
ok(mixedAdd.evicted.length === 1 && mixedAdd.evicted[0].startsWith("ma"), `the evicted row is an AUTO row (${JSON.stringify(mixedAdd.evicted)})`);
ok(mixedAfter.filter((m) => m.source === "user").length === 190, "every USER row survived an auto candidate's eviction");

// --- F-164: a USER add at the cap evicts the lowest AUTO row if there is one...
reset([]);
storage.__seed(MEMORIES_KEY, mixed.map((m) => ({ ...m })));
const userAdd1 = await saveMemoryCandidate({ content: "a user lesson about release train cadence", source: "user" });
ok(userAdd1.stored === true && userAdd1.evicted.length === 1 && userAdd1.evicted[0].startsWith("ma"),
  `a USER add at the cap evicts the lowest AUTO row (${JSON.stringify(userAdd1.evicted)})`);
ok(load().filter((m) => m.source === "user").length === 191, "every hand-authored row survived a USER add");

// --- F-164: ...and at an ALL-USER cap it is REFUSED — a hand-authored memory is NEVER
// evicted by the app. Before F-164 the lowest-scoring user row (u0) was silently destroyed
// behind a "Memory saved" toast, with no tombstone and no undo.
reset([]);
storage.__seed(MEMORIES_KEY, allUser.map((m) => ({ ...m })));
const beforeUserJson = JSON.stringify(load());
const userAdd2 = await saveMemoryCandidate({ content: "a user lesson about release train cadence", source: "user" });
ok(userAdd2.stored === false && userAdd2.id === null && userAdd2.reason === "cap",
  `a USER add at an all-user cap is REFUSED with reason 'cap' (got ${JSON.stringify({ stored: userAdd2.stored, reason: userAdd2.reason })})`);
ok(JSON.stringify(load()) === beforeUserJson, "the refused USER add leaves the store BYTE-IDENTICAL (u0 is not evicted)");
ok(load().length === 200 && load().some((m) => m.id === "u0"), "the lowest-scoring hand-authored memory is still there");

// --- F-164: an OVERSIZED all-user store re-saved with no newcomer must not spin forever
// (the prune has nothing it is allowed to evict) — it returns, over cap, rather than hanging
// or eating a user row.
const over = allUser.map((m) => ({ ...m })).concat([{ id: "u200", content: "one row over the cap", source: "user", confidence: 1, reinforcements: 0, disabled: false, updatedAt: "2026-03-01T00:00:00Z" }]);
const pf = pruneForSave(over, null);
ok(pf.out.length === 201 && pf.evicted.length === 0, `an all-user over-cap array is left intact rather than pruned (${pf.out.length} rows, ${pf.evicted.length} evicted)`);

// --- F-159/F-161: at the cap with every OTHER row higher-scoring AUTO, a new fix row must never
// "succeed" into a vanished id. Either it is stored (and a lower-value auto row goes), or
// stored:false with reason "cap"/"bytes" — and in that case the store is left untouched.
reset([]);
const full = [];
for (let i = 0; i < 200; i++) full.push({ id: `hv${i}`, content: `high value lesson number ${i} distinct`, source: "test", confidence: 0.95, reinforcements: 5, disabled: false, updatedAt: `2026-02-01T00:00:${String(i % 60).padStart(2, "0")}Z` });
storage.__seed(MEMORIES_KEY, full);
const atCap = await saveMemoryCandidate({ content: "a totally novel fix lesson about webhook retries", source: "fix", confidence: 0.2 });
const post = load();
ok(typeof atCap.stored === "boolean", "saveMemoryCandidate reports `stored`");
if (atCap.stored) {
  ok(atCap.id && post.some((m) => m.id === atCap.id), "a reported id EXISTS in the store after the save (no success for a vanished id)");
  ok(post.length <= 200, `store still within the cap (${post.length})`);
  ok(Array.isArray(atCap.evicted) && atCap.evicted.length === 1 && atCap.evicted[0] !== atCap.id,
    `the evicted row is another one, and it is reported (${JSON.stringify(atCap.evicted)})`);
  ok(!post.some((m) => m.id === atCap.evicted[0]), "the reported evicted id is really gone");
} else {
  ok(atCap.id === null && (atCap.reason === "cap" || atCap.reason === "bytes"), "a rejected candidate returns id:null with reason 'cap' or 'bytes'");
  ok(post.length === 200, "a rejected candidate leaves the store untouched");
}


// === F-176/F-177: an ARCHIVED row is NEVER evicted (the F-173 policy, REVERSED) ===
// Archive is this app's NON-destructive action (it has a Restore twin; only Delete warns
// "cannot be undone"). Under F-173 a background auto-capture permanently destroyed a
// deliberately archived hand-authored memory, silently. Now archived rows keep their slot
// and count toward the cap: the fix candidate is REFUSED and the store is byte-identical.
{
  const seed = [];
  for (let i = 0; i < MAX_MEMORIES; i++) {
    seed.push({
      id: `u${i}`, content: `a curated user lesson number ${i} distinct`, source: "user",
      confidence: 1.0, reinforcements: 5, disabled: i === 42,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    });
  }
  reset(seed);
  const beforeArch = JSON.stringify(load());
  const r = await saveMemoryCandidate({ content: "a novel lesson learned while fixing generated code", source: "fix", confidence: 0.2 });
  ok(r.stored === false && r.id === null && r.reason === "cap",
    `F-176: the fix candidate is REFUSED at an all-user cap holding one archived row (got ${JSON.stringify({ stored: r.stored, reason: r.reason })})`);
  ok(JSON.stringify(r.evicted) === "[]", `F-176: nothing is evicted (got ${JSON.stringify(r.evicted)})`);
  const afterArch = load();
  ok(JSON.stringify(afterArch) === beforeArch, "F-176: the store is BYTE-IDENTICAL after the refusal");
  ok(afterArch.some((m) => m.id === "u42" && m.disabled === true), "F-176/F-177: the ARCHIVED hand-authored memory SURVIVES — archiving never risks a memory");
}

// --- an ARCHIVED AUTO row is not evictable either (archived is archived, whatever the source),
// while a LIVE auto row in the same store is the victim. This is the whole pool rule in one fixture.
{
  const seed = [];
  for (let i = 0; i < MAX_MEMORIES - 2; i++) {
    seed.push({ id: `u${i}`, content: `a curated user lesson number ${i} distinct`, source: "user", confidence: 1.0, reinforcements: 5, disabled: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  }
  seed.push({ id: "autoArchived", content: "an archived auto lesson about webhook retry", source: "fix", confidence: 0.01, reinforcements: 0, disabled: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  seed.push({ id: "autoLive", content: "a live auto lesson about sprint mapping", source: "test", confidence: 0.9, reinforcements: 5, disabled: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  reset(seed);
  const r = await saveMemoryCandidate({ content: "a totally novel lesson about attachment uploads", source: "fix", confidence: 0.2 });
  ok(r.stored === true && JSON.stringify(r.evicted) === JSON.stringify(["autoLive"]),
    `the victim is the LIVE auto row, never the archived one (got ${JSON.stringify(r.evicted)})`);
  ok(load().some((m) => m.id === "autoArchived"), "the ARCHIVED auto row survives (a lower score than the victim, but not evictable)");
}

console.log(`\nmemory-dedup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
