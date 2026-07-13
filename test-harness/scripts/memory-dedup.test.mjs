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

console.log(`\nmemory-dedup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
