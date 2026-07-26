/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline STRUCTURAL unit test for the two seed data-sets: src/shared/builtin-docs.js (Documentation
// Library seeds) and src/shared/builtin-skills.js (starter skill packs). These are curated DATA the
// seeders (seedBuiltinDocs in index.js, seedBuiltinSkills in skills.js) upsert by stable id, so a
// malformed row ships silently to every install on the next version bump. This test asserts the shape,
// caps, id uniqueness, taxonomy conformance, and the "examples reference only real sandbox api.* methods"
// contract the file headers promise — validated against the SINGLE SOURCE of caps (skills.js) and of the
// api surface (sandbox-api-spec.js), never re-hardcoded blindly.
//
// SKILL_CATEGORIES + autoMatchSkills are imported from skills.js (which imports @forge/kvs), so this suite
// MUST run under the mock loader:
//   node --import ../lib/register-mocks.mjs scripts/builtin-seeds.test.mjs
import { BUILTIN_DOCS, DOC_SEED_VERSION } from "../../src/shared/builtin-docs.js";
import { BUILTIN_SKILLS, SKILL_SEED_VERSION } from "../../src/shared/builtin-skills.js";
import { KNOWN_API_MEMBERS } from "../../src/shared/sandbox-api-spec.js";
import { SKILL_CATEGORIES, autoMatchSkills } from "../../src/skills.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// === Caps — mirror the ENFORCED limits in the app (do NOT invent numbers) ===
// skills.js: NAME_MAX 80, DESCRIPTION_MAX 300, TAGS_MAX 10, TAG_LEN_MAX 30,
//            INSTRUCTIONS_MAX 24000, EXAMPLES_MAX 16000, RECORD_MAX_CHARS 45000,
//            operationTypes .slice(0,8); fetchSkillsBlock capBytes 24576.
const NAME_MAX = 80, DESCRIPTION_MAX = 300, TAGS_MAX = 10, TAG_LEN_MAX = 30;
const INSTRUCTIONS_MAX = 24000, EXAMPLES_MAX = 16000, RECORD_MAX_CHARS = 45000;
const MAX_OP_TYPES = 8, SKILL_BLOCK_CAP = 24576;
// index.js saveContextDoc: title.substring(0,100), content rejected over 200000.
const DOC_TITLE_MAX = 100, DOC_CONTENT_MAX = 200000;
// The valid step operation types (FunctionBlock OPERATION_TYPES + the distill JSON contract in index.js).
const VALID_OP_TYPES = new Set(["work_item_query", "rest_api_internal", "rest_api_external", "confluence_api", "log_function"]);
const KNOWN = new Set(KNOWN_API_MEMBERS);
// The ONE method the seeds deliberately NAME as unavailable (there is no api.deleteIssue in the sandbox).
const SANCTIONED_UNAVAILABLE = new Set(["deleteIssue"]);

const apiRefs = (txt) => Array.from(new Set((String(txt).match(/api\.([a-zA-Z_]\w*)/g) || []).map((x) => x.slice(4))));
const isStr = (v) => typeof v === "string";
const nonEmpty = (v) => isStr(v) && v.trim().length > 0;

// ============================================================================
// 1) Seed versions — both are positive integers (the seeder compares meta.seedVersion >= X)
// ============================================================================
ok(typeof DOC_SEED_VERSION === "number" && Number.isInteger(DOC_SEED_VERSION) && DOC_SEED_VERSION >= 1,
  `DOC_SEED_VERSION is a positive integer (got ${DOC_SEED_VERSION})`);
ok(typeof SKILL_SEED_VERSION === "number" && Number.isInteger(SKILL_SEED_VERSION) && SKILL_SEED_VERSION >= 1,
  `SKILL_SEED_VERSION is a positive integer (got ${SKILL_SEED_VERSION})`);

// ============================================================================
// 2) BUILTIN_DOCS — non-empty array of well-formed rows
// ============================================================================
ok(Array.isArray(BUILTIN_DOCS) && BUILTIN_DOCS.length > 0, `BUILTIN_DOCS is a non-empty array (${BUILTIN_DOCS.length} docs)`);

{
  const bad = BUILTIN_DOCS.filter((d) => !(d && nonEmpty(d.id) && nonEmpty(d.title) && nonEmpty(d.category) && nonEmpty(d.content)));
  ok(bad.length === 0, `every doc has non-empty string id/title/category/content (offenders: ${bad.map((d) => d && d.id).join(",")})`);
}
{
  const ids = BUILTIN_DOCS.map((d) => d.id);
  ok(new Set(ids).size === ids.length, "doc ids are UNIQUE within the seed");
  const badPrefix = ids.filter((id) => !/^builtin_doc_[a-z0-9_]+$/.test(id));
  ok(badPrefix.length === 0, `every doc id matches the builtin_doc_* convention (offenders: ${badPrefix.join(",")})`);
}
{
  const longTitle = BUILTIN_DOCS.filter((d) => d.title.length > DOC_TITLE_MAX);
  ok(longTitle.length === 0, `no doc title exceeds ${DOC_TITLE_MAX} (saveContextDoc truncates) (offenders: ${longTitle.map((d) => d.id).join(",")})`);
  const badContent = BUILTIN_DOCS.filter((d) => d.content.length > DOC_CONTENT_MAX || d.content.length < 200);
  ok(badContent.length === 0, `every doc content is non-trivial and <= ${DOC_CONTENT_MAX} (offenders: ${badContent.map((d) => `${d.id}:${d.content.length}`).join(",")})`);
}
{
  // Curated content must not carry a RAW fence sentinel (defangFence runs at injection, but a raw
  // <<< / >>> in seed data is a smell — the whole point is these are trusted-but-bounded).
  const sentinel = BUILTIN_DOCS.filter((d) => /<<<|>>>/.test(d.content));
  ok(sentinel.length === 0, `no doc content contains a raw fence sentinel (offenders: ${sentinel.map((d) => d.id).join(",")})`);
}

// ============================================================================
// 3) BUILTIN_SKILLS — non-empty array of well-formed rows
// ============================================================================
ok(Array.isArray(BUILTIN_SKILLS) && BUILTIN_SKILLS.length > 0, `BUILTIN_SKILLS is a non-empty array (${BUILTIN_SKILLS.length} skills)`);

{
  const bad = BUILTIN_SKILLS.filter((s) => !(s && nonEmpty(s.id) && nonEmpty(s.name) && nonEmpty(s.description)
    && nonEmpty(s.instructions) && isStr(s.examples) && Array.isArray(s.tags) && Array.isArray(s.operationTypes)));
  ok(bad.length === 0, `every skill has id/name/description/instructions + examples(str)/tags(arr)/operationTypes(arr) (offenders: ${bad.map((s) => s && s.id).join(",")})`);
}
{
  const ids = BUILTIN_SKILLS.map((s) => s.id);
  ok(new Set(ids).size === ids.length, "skill ids are UNIQUE within the seed");
  const badPrefix = ids.filter((id) => !/^builtin_skill_[a-z0-9_]+$/.test(id));
  ok(badPrefix.length === 0, `every skill id matches the builtin_skill_* convention (offenders: ${badPrefix.join(",")})`);
}

// --- category MUST be within the fixed taxonomy (else seedBuiltinSkills silently coerces it to "Other") ---
ok(Array.isArray(SKILL_CATEGORIES) && SKILL_CATEGORIES.length === 6, `SKILL_CATEGORIES is the 6-entry fixed taxonomy (got ${SKILL_CATEGORIES.length})`);
{
  const off = BUILTIN_SKILLS.filter((s) => !SKILL_CATEGORIES.includes(s.category));
  ok(off.length === 0, `every skill.category is in SKILL_CATEGORIES (offenders: ${off.map((s) => `${s.id}:${s.category}`).join(",")})`);
}

// --- field caps: name / description / instructions / examples ---
{
  const badName = BUILTIN_SKILLS.filter((s) => s.name.length > NAME_MAX);
  ok(badName.length === 0, `no skill name exceeds ${NAME_MAX} (offenders: ${badName.map((s) => s.id).join(",")})`);
  const badDesc = BUILTIN_SKILLS.filter((s) => s.description.length > DESCRIPTION_MAX);
  ok(badDesc.length === 0, `no skill description exceeds ${DESCRIPTION_MAX} (save truncates mid-sentence) (offenders: ${badDesc.map((s) => `${s.id}:${s.description.length}`).join(",")})`);
  const badInstr = BUILTIN_SKILLS.filter((s) => s.instructions.length > INSTRUCTIONS_MAX);
  ok(badInstr.length === 0, `no skill instructions exceed ${INSTRUCTIONS_MAX} (offenders: ${badInstr.map((s) => `${s.id}:${s.instructions.length}`).join(",")})`);
  const badEx = BUILTIN_SKILLS.filter((s) => s.examples.length > EXAMPLES_MAX);
  ok(badEx.length === 0, `no skill examples exceed ${EXAMPLES_MAX} (offenders: ${badEx.map((s) => `${s.id}:${s.examples.length}`).join(",")})`);
  // Every builtin ships a worked example (fetchSkillsBlock appends it) — an empty one is a quality gap.
  const noEx = BUILTIN_SKILLS.filter((s) => !nonEmpty(s.examples));
  ok(noEx.length === 0, `every builtin skill ships a non-empty examples block (offenders: ${noEx.map((s) => s.id).join(",")})`);
}

// --- tags: non-empty array, <= TAGS_MAX, each a lowercase non-empty string <= TAG_LEN_MAX, unique ---
{
  const badCount = BUILTIN_SKILLS.filter((s) => s.tags.length === 0 || s.tags.length > TAGS_MAX);
  ok(badCount.length === 0, `every skill has 1..${TAGS_MAX} tags (offenders: ${badCount.map((s) => `${s.id}:${s.tags.length}`).join(",")})`);
  const badTag = BUILTIN_SKILLS.filter((s) => s.tags.some((t) => !nonEmpty(t) || t.length > TAG_LEN_MAX || t !== String(t).toLowerCase()));
  ok(badTag.length === 0, `every tag is a lowercase non-empty string <= ${TAG_LEN_MAX} chars (offenders: ${badTag.map((s) => s.id).join(",")})`);
  const dupTag = BUILTIN_SKILLS.filter((s) => new Set(s.tags).size !== s.tags.length);
  ok(dupTag.length === 0, `no skill repeats a tag (offenders: ${dupTag.map((s) => s.id).join(",")})`);
}

// --- operationTypes: 1..MAX_OP_TYPES entries, each a valid step operation type ---
{
  const badCount = BUILTIN_SKILLS.filter((s) => s.operationTypes.length === 0 || s.operationTypes.length > MAX_OP_TYPES);
  ok(badCount.length === 0, `every skill declares 1..${MAX_OP_TYPES} operationTypes (offenders: ${badCount.map((s) => `${s.id}:${s.operationTypes.length}`).join(",")})`);
  const badOp = BUILTIN_SKILLS.filter((s) => s.operationTypes.some((o) => !VALID_OP_TYPES.has(o)));
  ok(badOp.length === 0, `every operationType is one of {${[...VALID_OP_TYPES].join(",")}} (offenders: ${badOp.map((s) => `${s.id}:[${s.operationTypes.filter((o) => !VALID_OP_TYPES.has(o))}]`).join(",")})`);
}

// --- serialized record stays under the persistence guard (a builtin must be able to round-trip a save) ---
{
  const over = BUILTIN_SKILLS.filter((s) => {
    const record = {
      id: s.id, name: s.name, category: s.category, description: s.description,
      tags: s.tags, operationTypes: s.operationTypes, builtin: true, enabled: true,
      contentLength: s.instructions.length + s.examples.length, createdBy: null,
      createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
      instructions: s.instructions, examples: s.examples,
    };
    return JSON.stringify(record).length >= RECORD_MAX_CHARS;
  });
  ok(over.length === 0, `every skill's serialized record is under RECORD_MAX_CHARS (${RECORD_MAX_CHARS}) (offenders: ${over.map((s) => s.id).join(",")})`);
}

// --- each skill's INJECTED block must fit fetchSkillsBlock's 24576 cap, else it drops itself + all after it ---
{
  const tooBig = BUILTIN_SKILLS.filter((s) => {
    let block = `### Skill: ${s.name}\n${s.instructions || ""}`;
    if (s.examples && String(s.examples).trim()) block += `\n\nExample:\n${s.examples}`;
    return block.length > SKILL_BLOCK_CAP;
  });
  ok(tooBig.length === 0, `every skill's rendered block fits the ${SKILL_BLOCK_CAP}-char injection cap (offenders: ${tooBig.map((s) => s.id).join(",")})`);
  // Raw fence sentinel in trusted skill content is a smell (mirrors the doc check).
  const sentinel = BUILTIN_SKILLS.filter((s) => /<<<|>>>/.test(s.instructions + s.examples));
  ok(sentinel.length === 0, `no skill content contains a raw fence sentinel (offenders: ${sentinel.map((s) => s.id).join(",")})`);
}

// ============================================================================
// 4) Sandbox-method contract — the file headers promise examples use ONLY real api.* methods
// ============================================================================
// (a) EXECUTABLE examples: every referenced api.<member> MUST exist in KNOWN_API_MEMBERS (no exceptions).
{
  const bad = [];
  for (const s of BUILTIN_SKILLS) {
    const unknown = apiRefs(s.examples).filter((m) => !KNOWN.has(m));
    if (unknown.length) bad.push(`${s.id}:[${unknown.join(",")}]`);
  }
  ok(bad.length === 0, `every api.* member used in skill EXAMPLES is a real sandbox method (offenders: ${bad.join(" ")})`);
}
// (b) PROSE instructions may NAME an unavailable method — but ONLY the sanctioned deleteIssue. Any other
//     unknown api.* member in instructions is an off-contract claim (an invented method that throws at runtime).
{
  const unknown = new Set();
  for (const s of BUILTIN_SKILLS) apiRefs(s.instructions).filter((m) => !KNOWN.has(m)).forEach((m) => unknown.add(m));
  const off = [...unknown].filter((m) => !SANCTIONED_UNAVAILABLE.has(m));
  ok(off.length === 0, `the only unknown api.* member across skill INSTRUCTIONS is the sanctioned 'deleteIssue' (extra offenders: ${off.join(",")})`);
}
// (c) The same discipline holds for doc CONTENT (sandbox notes reference api.* too).
{
  const unknown = new Set();
  for (const d of BUILTIN_DOCS) apiRefs(d.content).filter((m) => !KNOWN.has(m)).forEach((m) => unknown.add(m));
  const off = [...unknown].filter((m) => !SANCTIONED_UNAVAILABLE.has(m));
  ok(off.length === 0, `the only unknown api.* member across doc CONTENT is the sanctioned 'deleteIssue' (extra offenders: ${off.join(",")})`);
}

// ============================================================================
// 5) Discoverability — every skill's own tags must actually auto-match it (score >= 3 threshold)
// ============================================================================
// A skill whose tags tokenize away to nothing (all stopwords/1-char) would be un-discoverable via the
// keyword matcher. Build a prompt from the skill's tags (hyphens -> spaces so multi-token tags satisfy
// the AND rule) and assert autoMatchSkills returns it.
{
  const undiscoverable = [];
  for (const s of BUILTIN_SKILLS) {
    const prompt = s.tags.join(" ").replace(/-/g, " ");
    const matched = autoMatchSkills(prompt, null, [{ ...s, enabled: true }], { max: 1 });
    if (!(matched.length === 1 && matched[0].id === s.id)) undiscoverable.push(s.id);
  }
  ok(undiscoverable.length === 0, `every skill is auto-matchable via its own declared tags (undiscoverable: ${undiscoverable.join(",")})`);
}
// A declared operationType alone (no prompt tokens) is +2 — below the >=3 threshold, so it must NOT
// self-match on op type only (guards against the taxonomy accidentally lowering the match bar).
{
  const s0 = BUILTIN_SKILLS[0];
  const opOnly = autoMatchSkills("zzzznotokenhere", s0.operationTypes[0], [{ ...s0, tags: [], name: "", description: "", enabled: true }]);
  ok(opOnly.length === 0, "operationType alone (+2) does not reach the >=3 auto-match threshold");
}

// ============================================================================
// 6) Cross-seed — doc ids and skill ids occupy disjoint id spaces
// ============================================================================
{
  const docIds = new Set(BUILTIN_DOCS.map((d) => d.id));
  const collide = BUILTIN_SKILLS.filter((s) => docIds.has(s.id));
  ok(collide.length === 0, `no id is shared between the doc seed and the skill seed (collisions: ${collide.map((s) => s.id).join(",")})`);
}

console.log(`\nbuiltin-seeds: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
