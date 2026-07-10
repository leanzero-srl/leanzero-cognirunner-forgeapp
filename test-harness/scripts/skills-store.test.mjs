/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Offline unit test for the SKILL STORE (src/skills.js) via the mock @forge/kvs — the three
// storage-touching functions: seedBuiltinSkills, saveSkillInternal, fetchSkillsBlock.
// Run: node --import ../lib/register-mocks.mjs scripts/skills-store.test.mjs   (see test:offline)
//
// Covers:
//  - seedBuiltinSkills: seeds from an absent/older seed_meta; SKIPS when meta >= SKILL_SEED_VERSION
//    (fresh cold container); warm re-run is a no-op (module flag); upsert-by-id never duplicates and
//    NEVER re-enables an admin-disabled builtin (preserves enabled:false + createdAt); custom rows survive.
//  - saveSkillInternal: name/instructions required; trim+clamp of name/description/instructions/examples;
//    tag normalization (trim/lowercase/30-char/drop-empty/cap-10); operationType normalization
//    (trim/40-char/cap-8, case PRESERVED); category validation; 100 custom-skill cap (builtins & updates
//    bypass); enabled/builtin/createdBy/createdAt precedence; the 45k serialized-size guard.
//  - fetchSkillsBlock: whole-skill concatenation, the HARD capBytes drop (a skill crossing the cap is
//    dropped WITH everything after it, order preserved), the === cap boundary, disabled/missing SKIP
//    (continue, not break), the first-8-ids slice, and defangFence on name/instructions/examples.
//
// Each seedBuiltinSkills scenario dynamic-imports a fresh skills.js (cache-bust query) so the module-level
// _skillsSeeded flag resets ("cold container"); all instances share the ONE mock-kvs store.
import storage from "../lib/mock-kvs.mjs";
import {
  saveSkillInternal, fetchSkillsBlock,
  SKILL_INDEX_KEY, SKILL_PREFIX, SKILL_SEED_META_KEY, SKILL_CATEGORIES,
} from "../../src/skills.js";
import { BUILTIN_SKILLS, SKILL_SEED_VERSION } from "../../src/shared/builtin-skills.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const idx = () => storage.__raw(SKILL_INDEX_KEY) || [];
const rec = (id) => storage.__raw(`${SKILL_PREFIX}${id}`);
const meta = () => storage.__raw(SKILL_SEED_META_KEY);
// fresh module instance (resets the module-level _skillsSeeded flag), shared storage
const freshSkills = (tag) => import(`../../src/skills.js?seed=${tag}`);

// =====================================================================================
// seedBuiltinSkills
// =====================================================================================

// --- B1: absent seed_meta + empty storage → seeds every builtin; warm re-run is a no-op ---
storage.__reset();
{
  const s = await freshSkills("b1");
  await s.seedBuiltinSkills();
  ok(idx().length === BUILTIN_SKILLS.length, `seeds all ${BUILTIN_SKILLS.length} builtins from empty`);
  ok(idx().every((r) => r.builtin === true), "every seeded row is builtin:true");
  ok(idx().every((r) => r.enabled === true), "every seeded row starts enabled:true");
  ok(idx().every((r) => SKILL_CATEGORIES.includes(r.category)), "every seeded category is in the fixed taxonomy");
  ok(meta() && meta().seedVersion === SKILL_SEED_VERSION, "seed_meta stamped with SKILL_SEED_VERSION");
  const r0 = rec(BUILTIN_SKILLS[0].id);
  ok(r0 && r0.instructions && r0.instructions.length > 0, "full content record stored (instructions present)");
  ok(r0 && r0.contentLength === (r0.instructions.length + (r0.examples || "").length), "contentLength = instructions+examples length");
  const indexRow0 = idx().find((r) => r.id === BUILTIN_SKILLS[0].id);
  ok(indexRow0 && !("instructions" in indexRow0), "index row is metadata-only (no instructions field)");
  // warm re-run: module flag short-circuits, storage untouched
  await s.seedBuiltinSkills();
  ok(idx().length === BUILTIN_SKILLS.length, "warm re-run does NOT duplicate (module flag no-op)");
}

// --- B2: fresh cold container but seed_meta already CURRENT → must NOT reseed ---
storage.__reset();
storage.__seed(SKILL_SEED_META_KEY, { seedVersion: SKILL_SEED_VERSION });
storage.__seed(SKILL_INDEX_KEY, []);
{
  const s = await freshSkills("b2");
  await s.seedBuiltinSkills();
  ok(idx().length === 0, "meta already at SKILL_SEED_VERSION → early-return, index left empty");
}

// --- B2b: seed_meta from a FUTURE version → also skips (>= comparison) ---
storage.__reset();
storage.__seed(SKILL_SEED_META_KEY, { seedVersion: SKILL_SEED_VERSION + 5 });
storage.__seed(SKILL_INDEX_KEY, []);
{
  const s = await freshSkills("b2b");
  await s.seedBuiltinSkills();
  ok(idx().length === 0, "meta ahead of SKILL_SEED_VERSION → still skips");
}

// --- B3: OLDER meta → reseed upserts by id; admin-disable + createdAt preserved; custom row survives ---
storage.__reset();
storage.__seed(SKILL_SEED_META_KEY, { seedVersion: SKILL_SEED_VERSION - 1 });
storage.__seed(SKILL_INDEX_KEY, [
  { id: BUILTIN_SKILLS[0].id, name: "old adf", category: "ADF & Formatting", tags: [], operationTypes: [], builtin: true, enabled: false, contentLength: 3, createdBy: null, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" },
  { id: "custom_keep", name: "my custom", category: "Other", tags: [], operationTypes: [], builtin: false, enabled: true, contentLength: 5, createdBy: "acct-1", createdAt: "2021-01-01T00:00:00.000Z", updatedAt: "2021-01-01T00:00:00.000Z" },
]);
{
  const s = await freshSkills("b3");
  await s.seedBuiltinSkills();
  const dup = idx().filter((r) => r.id === BUILTIN_SKILLS[0].id);
  ok(dup.length === 1, "reseed upserts by id — no duplicate builtin row");
  ok(dup[0] && dup[0].enabled === false, "reseed NEVER re-enables an admin-disabled builtin (enabled:false kept)");
  ok(dup[0] && dup[0].createdAt === "2020-01-01T00:00:00.000Z", "existing createdAt preserved through reseed");
  ok(idx().some((r) => r.id === "custom_keep"), "a pre-existing custom row survives the reseed");
  ok(idx().length === BUILTIN_SKILLS.length + 1, "index = all builtins + the surviving custom row");
  ok(meta().seedVersion === SKILL_SEED_VERSION, "seed_meta bumped to current version after reseed");
}

// =====================================================================================
// saveSkillInternal
// =====================================================================================

// --- required fields ---
storage.__reset();
ok((await saveSkillInternal({ name: "" }, { instructions: "x" })).success === false, "empty name → error");
ok((await saveSkillInternal({ name: "   " }, { instructions: "x" })).success === false, "whitespace-only name → error");
ok((await saveSkillInternal({ name: "N" }, { instructions: "   " })).success === false, "whitespace-only instructions → error");
ok((await saveSkillInternal({ name: "N" }, {})).success === false, "missing instructions → error");

// --- trim + clamp of name / description / instructions / examples ---
storage.__reset();
{
  const r = await saveSkillInternal(
    { name: "   " + "N".repeat(100), description: "  " + "d".repeat(400), category: "Jira API" },
    { instructions: "i".repeat(30000), examples: "e".repeat(20000) },
  );
  ok(r.success === true, "valid save succeeds");
  ok(r.row.name === "N".repeat(80), "name trimmed then clamped to 80");
  ok(r.row.description === "d".repeat(300), "description trimmed then clamped to 300");
  const stored = rec(r.id);
  ok(stored.instructions.length === 24000, "instructions clamped to 24000");
  ok(stored.examples.length === 16000, "examples clamped to 16000");
  ok(r.row.contentLength === 24000 + 16000, "contentLength reflects clamped lengths");
  ok(!("instructions" in r.row) && !("examples" in r.row), "returned index row carries no content");
  ok(("instructions" in stored) && ("examples" in stored), "content record carries the content");
}

// --- category validation ---
storage.__reset();
ok((await saveSkillInternal({ name: "A", category: "Workflow Patterns" }, { instructions: "x" })).row.category === "Workflow Patterns", "valid category kept");
ok((await saveSkillInternal({ name: "B", category: "Totally Made Up" }, { instructions: "x" })).row.category === "Other", "invalid category → Other");
ok((await saveSkillInternal({ name: "C" }, { instructions: "x" })).row.category === "Other", "missing category → Other");

// --- tag normalization: trim, lowercase, 30-char clamp, drop empties, cap at 10 ---
storage.__reset();
{
  const r = await saveSkillInternal(
    { name: "T", tags: [" Foo ", "BAR", "", "   ", "Baz", "q".repeat(60), "t1", "t2", "t3", "t4", "t5", "t6", "t7"] },
    { instructions: "x" },
  );
  const t = r.row.tags;
  ok(t.length === 10, "tags capped at 10 (11 non-empty → 10)");
  ok(t[0] === "foo" && t[1] === "bar" && t.includes("baz"), "tags trimmed + lowercased");
  ok(!t.some((x) => x === ""), "empty/whitespace tags dropped");
  ok(t.some((x) => x.length === 30 && /^q+$/.test(x)), "over-long tag clamped to 30 chars");
  const r2 = await saveSkillInternal({ name: "T2", tags: "notanarray" }, { instructions: "x" });
  ok(Array.isArray(r2.row.tags) && r2.row.tags.length === 0, "non-array tags → []");
}

// --- operationType normalization: trim, 40-char clamp, cap 8, CASE PRESERVED (not lowercased) ---
storage.__reset();
{
  const r = await saveSkillInternal(
    { name: "O", operationTypes: [" Foo ", "", "BarBaz", "x".repeat(50), "o1", "o2", "o3", "o4", "o5", "o6"] },
    { instructions: "x" },
  );
  const o = r.row.operationTypes;
  ok(o.length === 8, "operationTypes capped at 8");
  ok(o.includes("Foo") && o.includes("BarBaz"), "operationTypes trimmed but case PRESERVED (not lowercased)");
  ok(o.some((x) => x.length === 40), "over-long operationType clamped to 40 chars");
}

// --- generated id + in-place update (no duplicate index row) ---
storage.__reset();
{
  const a = await saveSkillInternal({ name: "A" }, { instructions: "x" });
  ok(/^skill_/.test(a.id), "id auto-generated with skill_ prefix when none supplied");
  ok(idx().length === 1, "new skill unshifted → index length 1");
  const b = await saveSkillInternal({ name: "A-renamed", id: a.id }, { instructions: "y" });
  ok(b.success === true && idx().length === 1, "update by id replaces in place (no duplicate)");
  ok(idx().find((r) => r.id === a.id).name === "A-renamed", "index row updated to new name");
}

// --- enabled / builtin / createdBy / createdAt precedence ---
storage.__reset();
ok((await saveSkillInternal({ name: "E1" }, { instructions: "x" })).row.enabled === true, "new skill defaults enabled:true");
ok((await saveSkillInternal({ name: "E2", enabled: false }, { instructions: "x" })).row.enabled === false, "meta.enabled:false honored on create");
{
  // seed a disabled custom row, then update WITHOUT specifying enabled → disable is preserved
  storage.__reset();
  storage.__seed(SKILL_INDEX_KEY, [{ id: "keep1", name: "old", category: "Other", tags: [], operationTypes: [], builtin: true, enabled: false, contentLength: 1, createdBy: "orig", createdAt: "2019-05-05T00:00:00.000Z", updatedAt: "2019-05-05T00:00:00.000Z" }]);
  const u = await saveSkillInternal({ name: "new name", id: "keep1" }, { instructions: "z" });
  ok(u.row.enabled === false, "update w/ undefined meta.enabled preserves existing enabled:false");
  ok(u.row.builtin === true, "existing builtin flag preserved on update");
  ok(u.row.createdBy === "orig", "existing createdBy preserved (meta.createdBy ignored when existing set)");
  ok(u.row.createdAt === "2019-05-05T00:00:00.000Z", "existing createdAt preserved on update");
  const re = await saveSkillInternal({ name: "reenabled", id: "keep1", enabled: true }, { instructions: "z" });
  ok(re.row.enabled === true, "explicit meta.enabled:true re-enables on update");
}
ok((await saveSkillInternal({ name: "CB", createdBy: "author-9" }, { instructions: "x" })).row.createdBy === "author-9", "createdBy taken from meta on create");

// --- 100 custom-skill cap: full → error; builtin save & existing-id update BYPASS the cap ---
storage.__reset();
{
  const hundred = [];
  for (let i = 0; i < 100; i++) hundred.push({ id: `c${i}`, name: `n${i}`, category: "Other", tags: [], operationTypes: [], builtin: false, enabled: true, contentLength: 1, createdBy: null, createdAt: "2022-01-01T00:00:00.000Z", updatedAt: "2022-01-01T00:00:00.000Z" });
  storage.__seed(SKILL_INDEX_KEY, hundred);
  const full = await saveSkillInternal({ name: "one too many" }, { instructions: "x" });
  ok(full.success === false && /full/i.test(full.error), "101st custom skill rejected (library full)");
  ok(idx().length === 100, "rejected save did not mutate the index");
  const bi = await saveSkillInternal({ name: "builtin bypass", builtin: true }, { instructions: "x" });
  ok(bi.success === true && bi.row.builtin === true, "builtin save bypasses the custom cap");
  const upd = await saveSkillInternal({ name: "c50 renamed", id: "c50" }, { instructions: "x" });
  ok(upd.success === true, "updating an existing custom skill bypasses the cap");
}

// --- 45k serialized-size guard (escape-expanding content pushes past the char limit) ---
storage.__reset();
{
  const big = await saveSkillInternal({ name: "big" }, { instructions: '"'.repeat(24000) });
  ok(big.success === false && /too large/i.test(big.error), "record whose JSON serialization >= 45000 chars is rejected");
  ok(idx().length === 0, "over-size save did not persist an index row");
}

// =====================================================================================
// fetchSkillsBlock
// =====================================================================================

// --- empty / non-array ids ---
ok((await fetchSkillsBlock(null)).text === "" && (await fetchSkillsBlock(null)).applied.length === 0, "null ids → empty block");
ok((await fetchSkillsBlock([])).applied.length === 0, "empty ids → empty block");
ok((await fetchSkillsBlock("nope")).applied.length === 0, "non-array ids → empty block");

// helper to seed a content record directly (bypasses saveSkillInternal for precise lengths)
const seedRec = (id, name, instructions, { examples = "", enabled = true } = {}) =>
  storage.__seed(`${SKILL_PREFIX}${id}`, { id, name, instructions, examples, enabled });

// A/B/C each: block = "### Skill: "(11) + name + "\n"(1) + instructions  →  11+1+1+50 = 63 chars
storage.__reset();
seedRec("a", "A", "a".repeat(50));
seedRec("b", "B", "b".repeat(50));
seedRec("c", "C", "c".repeat(50));

// --- HARD cap: A(63) fits; A+"\n\n"+B = 128 > 100 → break, B & C dropped, order preserved ---
{
  const r = await fetchSkillsBlock(["a", "b", "c"], { capBytes: 100 });
  ok(r.applied.length === 1 && r.applied[0].id === "a", "cap drop: only A applied (B crosses the cap)");
  ok(r.text.length === 63, "cap drop: text is exactly A's block (63 chars)");
  ok(r.text.includes("a".repeat(50)) && !r.text.includes("b".repeat(4)), "cap drop: B (and C after it) excluded");
}

// --- all fit: cap large → A,B,C in order; total = 63 + 2 + 63 + 2 + 63 = 193 ---
{
  const r = await fetchSkillsBlock(["a", "b", "c"], { capBytes: 1000 });
  ok(r.applied.map((x) => x.id).join(",") === "a,b,c", "all-fit preserves caller order a,b,c");
  ok(r.text.length === 193, "all-fit total length is 193");
}

// --- boundary: candidate.length === capBytes is INCLUDED (only strictly-greater breaks) ---
ok((await fetchSkillsBlock(["a"], { capBytes: 63 })).applied.length === 1, "block length === capBytes → included");
ok((await fetchSkillsBlock(["a"], { capBytes: 62 })).applied.length === 0, "block length one over capBytes → dropped (even as first)");

// --- disabled + missing skills SKIP (continue), later skills still considered ---
storage.__reset();
seedRec("a", "A", "a".repeat(50));
seedRec("b", "B", "b".repeat(50), { enabled: false });
seedRec("c", "C", "c".repeat(50));
{
  const r = await fetchSkillsBlock(["a", "b", "c"], { capBytes: 1000 });
  ok(r.applied.map((x) => x.id).join(",") === "a,c", "disabled skill B skipped (continue), C still applied");
  ok(!r.text.includes("b".repeat(4)), "disabled skill content absent from block");
  const r2 = await fetchSkillsBlock(["a", "does-not-exist", "c"], { capBytes: 1000 });
  ok(r2.applied.map((x) => x.id).join(",") === "a,c", "missing skill skipped (continue), C still applied");
}

// --- only the first 8 ids are ever fetched (ids.slice(0,8)) ---
storage.__reset();
for (let i = 1; i <= 9; i++) seedRec(`s${i}`, `s${i}`, "x".repeat(5));
{
  const r = await fetchSkillsBlock(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"], { capBytes: 100000 });
  ok(r.applied.length === 8, "at most the first 8 ids are fetched");
  ok(!r.applied.some((x) => x.id === "s9"), "the 9th id is never fetched, even with a huge cap");
}

// --- defangFence applied to name, instructions AND examples (no literal fence tokens leak through) ---
storage.__reset();
seedRec("d", "<<<SKILLS name", ">>>END instructions", { examples: "<<<<EX>>>>" });
{
  const r = await fetchSkillsBlock(["d"], { capBytes: 100000 });
  ok(!r.text.includes("<<<") && !r.text.includes(">>>"), "fence runs (<<<, >>>) defanged out of the block");
  ok(r.text.includes("<<SKILLS name") && r.text.includes(">>END instructions"), "defanged name + instructions present");
  ok(r.text.includes("Example:") && r.text.includes("<<EX>>"), "examples section present and defanged");
}

console.log(`\nskills-store: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
