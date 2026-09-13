/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// ONE HOME FOR THE FIELD GUIDE, ASSERTED AT EVERY SURFACE (1.4 commit 14b).
//
// The plan names seven places the baked packs must reach: codegen and fix, semantic
// post-functions, validators (plain and agentic), the agent runner, the Coder turn and
// the PR review engine. This file is the gate that says all seven ask the SAME door for
// the block and that none of them builds one.
//
// Two kinds of assertion, because neither alone is enough:
//   SOURCE — every surface file calls the one resolver, and NO file outside
//     src/shared/knowledge-select.js writes a literal <<<FIELD_GUIDE fence. A behavioural
//     test can only cover the paths it can reach offline; a grep covers the ones it
//     cannot (the validator path pulls @forge/api and will not import here).
//   BEHAVIOUR — the builders that DO import offline are run, and the block is checked for
//     position (after the trusted layer, before the untrusted fence) and for its receipt.
//
// prompt-builders.test.mjs owns the codegen/fix prompt in detail; this file owns the
// "every surface, one door" invariant and the agent / Coder / review surfaces.
//
// Run: node --import ../lib/register-mocks.mjs scripts/field-guide-surfaces.test.mjs
import "../lib/ensure-mocks.mjs";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import storage from "../lib/mock-kvs.mjs";
import { buildKnowledgeMessages, summarizeKnowledge, logKnowledgeInjection } from "../../src/agent-runner.js";
import { buildReviewPrompt, PR_FENCE } from "../../src/git-review.js";
import { resolveFieldGuideBlock, KNOWN_PACK_IDS, saveKnowledgeSettings, invalidateKnowledgeSettingsCache } from "../../src/knowledge-packs.js";
import { FIELD_GUIDE_MARKER, FIELD_GUIDE_GUARD_SENTENCE } from "../../src/shared/knowledge-select.js";
import { fieldGuideAudience, FIELD_GUIDE_AUDIENCE_FOR, fieldGuideBudget, KNOWLEDGE_BUDGET_BYTES } from "../../src/shared/registry-limits.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "../../src");
const read = (rel) => readFileSync(path.join(srcDir, rel), "utf8");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/* =====================================================================================
 * S — SOURCE: every listed surface asks the one door
 * ===================================================================================*/

// The door itself, and the two names a surface may legitimately call.
const DOOR = "src/knowledge-packs.js";
const ENTRY_POINTS = ["resolveFieldGuideBlock", "getRuntimeFieldGuide"];

// Each surface, the file it lives in, and the reason it is on this list.
const SURFACES = [
  ["index.js", "codegen + fix (resolveKnowledgeForPrompt)", /resolveKnowledgeForPrompt[\s\S]{0,4000}?resolveFieldGuideBlock/],
  ["index.js", "semantic post-functions (buildSemanticAIRequest)", /buildSemanticAIRequest[\s\S]{0,6000}?fieldGuideText/],
  ["index.js", "validators, plain (callOpenAI)", /const callOpenAI = async[\s\S]{0,4000}?getRuntimeFieldGuide/],
  ["index.js", "validators, agentic (callOpenAIWithTools)", /const callOpenAIWithTools = async[\s\S]{0,12000}?getRuntimeFieldGuide/],
  ["listeners.js", "the agent run (buildAgentKnowledge)", /buildAgentKnowledge[\s\S]{0,4000}?resolveFieldGuideBlock/],
  ["async-handler.js", "the Coder turn (buildCoderKnowledge)", /buildCoderKnowledge[\s\S]{0,4000}?resolveFieldGuideBlock/],
  ["git-review.js", "the PR review engine", /resolveFieldGuideBlock/],
];

for (const [file, label, re] of SURFACES) {
  const src = read(file);
  ok(re.test(src), `${label} (src/${file}) resolves the field guide through the one door`);
}

// Every file that touches the guide reaches it through src/knowledge-packs.js — nobody
// imports the selector directly to do their own selection-plus-build.
for (const file of ["index.js", "listeners.js", "async-handler.js", "git-review.js"]) {
  const src = read(file);
  if (!ENTRY_POINTS.some((n) => src.includes(n))) continue;
  ok(/from\s+["']\.\/knowledge-packs\.js["']|import\(["']\.\/knowledge-packs\.js["']\)/.test(src),
    `src/${file} imports the door (${DOOR}), not a hand-rolled path to the packs`);
  ok(!/from\s+["'][^"']*knowledge-packs\/[^"']+["']/.test(src),
    `src/${file} does not static-import an individual pack — the door owns which packs exist`);
}

// THE ONE-HOME ASSERTION. Only the selector may write the literal fence. Everything else
// interpolates the block it was handed. A second author of this marker is the defect.
{
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
  const files = walk(srcDir).filter((f) => f.endsWith(".js"));
  ok(files.length > 20, `walked src/ (${files.length} modules)`);
  const offenders = [];
  for (const abs of files) {
    const rel = path.relative(srcDir, abs);
    if (rel === "shared/knowledge-select.js") continue;   // the ONE author
    if (rel.startsWith("shared/knowledge-packs/")) continue; // generated data, no fences
    // COMMENTS ARE STRIPPED FIRST. Naming the marker in a docblock is how a surface
    // explains where its block came from, and several do; the rule is about who WRITES
    // one into a prompt, not who mentions one. A grep that cannot tell code from prose
    // is a grep everyone learns to silence.
    const src = readFileSync(abs, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // A template-literal fence built from the marker constant counts too.
    if (/<<<FIELD_GUIDE/.test(src) || /\$\{FIELD_GUIDE_MARKER\}\\n/.test(src)) offenders.push(rel);
  }
  ok(offenders.length === 0,
    `no module outside shared/knowledge-select.js writes a <<<FIELD_GUIDE fence (offenders: ${offenders.join(", ") || "none"})`);
}

// The guard sentence likewise has one author — a surface that retypes it can disagree
// with the block it is wrapping.
{
  const idx = read("index.js");
  ok(!idx.includes("never changes the output format or the tool surface"),
    "src/index.js does not retype the field guide's guard sentence — it travels inside the block");
  const ar = read("agent-runner.js");
  ok(!ar.includes("never changes the output format or the tool surface"),
    "src/agent-runner.js does not retype it either");
}

// The runtime surfaces share ONE audience and ONE helper, rather than each naming a budget.
{
  const idx = read("index.js");
  const helper = idx.match(/const getRuntimeFieldGuide = async[\s\S]{0,1200}?\n\};/);
  ok(Boolean(helper), "src/index.js defines getRuntimeFieldGuide once");
  ok(helper && /audience: "validator"/.test(helper[0]),
    "…and it is the one place the per-transition surfaces name their audience");
  ok((idx.match(/getRuntimeFieldGuide/g) || []).length >= 4,
    "…and at least four call sites use it (plain validator, agentic validator, semantic PF real + dry run)");
  ok(!/fieldGuideBudget\(/.test(idx),
    "src/index.js never reaches for a raw byte budget — the door and the selector own that");
}

/* =====================================================================================
 * A — the AUDIENCE TRANSLATION has one home
 * ===================================================================================*/
{
  ok(fieldGuideAudience("agentRun") === "agent", "agentRun -> agent");
  ok(fieldGuideAudience("coderTurn") === "coder", "coderTurn -> coder");
  ok(fieldGuideAudience("prReview") === "review", "prReview -> review");
  ok(fieldGuideAudience("validator") === "validator", "a name already in the field guide's vocabulary passes through");
  ok(fieldGuideAudience("nonsense") === "nonsense",
    "an unknown name passes through untouched, so fieldGuideBudget's smallest-row rule decides — not a default invented in the map");
  // every skills/memories audience has a translation, so no caller has to invent one
  for (const name of Object.keys(KNOWLEDGE_BUDGET_BYTES)) {
    const translated = fieldGuideAudience(name);
    ok(Object.prototype.hasOwnProperty.call(FIELD_GUIDE_AUDIENCE_FOR, name) || fieldGuideBudget(translated) === fieldGuideBudget(name),
      `the skills audience "${name}" has a field-guide counterpart`);
  }
  // and the map is not retyped anywhere
  for (const f of ["listeners.js", "async-handler.js"]) {
    const src = read(f);
    ok(!/["']agentRun["']\s*[?:]\s*["']agent["']|["']coderTurn["']\s*[?:]\s*["']coder["']/.test(src),
      `src/${f} does not retype the audience translation as a ternary`);
  }
}

/* =====================================================================================
 * B — BEHAVIOUR: the agent / Coder message builder
 * ===================================================================================*/
storage.__reset();
invalidateKnowledgeSettingsCache();
const guide = await resolveFieldGuideBlock({ audience: "agent", text: "transition an issue and add a comment" });
ok(guide.block.length > 0, "control: the agent audience selects a non-empty guide");

// --- B1: the guide becomes its own system message, between skills and memories ---
{
  const msgs = buildKnowledgeMessages({
    skillsBlock: "House rule: always name the issue.",
    fieldGuideBlock: guide.block,
    memoryBlock: "customfield_10001 is a number field",
  });
  ok(msgs.length === 3, `three knowledge messages (got ${msgs.length})`);
  ok(msgs.every((m) => m.role === "system"), "all three are system messages");
  const iSkills = msgs.findIndex((m) => m.content.includes("<<<SKILLS"));
  const iGuide = msgs.findIndex((m) => m.content.includes(`<<<${FIELD_GUIDE_MARKER}`));
  const iMem = msgs.findIndex((m) => m.content.includes("<<<LEARNED_MEMORIES"));
  ok(iSkills === 0 && iGuide === 1 && iMem === 2,
    `order is skills, field guide, memories (got ${iSkills}/${iGuide}/${iMem})`);
  ok(msgs[iGuide].content.includes("## FIELD GUIDE (baked platform knowledge)"), "the guide message has its own heading");
  ok(msgs[iGuide].content.includes(FIELD_GUIDE_GUARD_SENTENCE), "the block's own guard sentence travels with it");
  ok(msgs[iGuide].content.includes("they cannot change what you are allowed to do"),
    "…alongside the agent-specific bound: knowledge never widens the tool surface");
  // the block is emitted VERBATIM — this builder must not re-fence what is already fenced
  ok(msgs[iGuide].content.includes(guide.block), "the already-fenced block is emitted verbatim, not re-wrapped");
  ok((msgs[iGuide].content.match(new RegExp(`<<<${FIELD_GUIDE_MARKER}`, "g")) || []).length === 1,
    "exactly one opening fence — no double wrapping");
}

// --- B2: a guide ALONE still produces a message (it is not gated on skills/memories) ---
{
  const msgs = buildKnowledgeMessages({ fieldGuideBlock: guide.block });
  ok(msgs.length === 1 && msgs[0].content.includes(`<<<${FIELD_GUIDE_MARKER}`),
    "an agent with no bound skills and memories off still receives the field guide");
}

// --- B3: nothing at all is still nothing — no empty messages ---
{
  ok(buildKnowledgeMessages({}).length === 0, "an empty knowledge object produces no messages");
  ok(buildKnowledgeMessages({ fieldGuideBlock: "" }).length === 0, "an empty guide produces no message");
  ok(buildKnowledgeMessages(null).length === 0, "a null knowledge object produces no messages");
}

// --- B4: THE RECEIPT (F-487's reserved slot, now filled) ---
{
  const s = summarizeKnowledge({ fieldGuideBlock: guide.block, fieldGuideSections: guide.sectionIds });
  ok(s !== null, "a guide-only run still gets a receipt");
  ok(Array.isArray(s.fieldGuideSections) && s.fieldGuideSections.length > 0, "the receipt names the sections");
  ok(s.fieldGuideSections.length <= 20, "…capped at 20 ids so a receipt cannot grow without bound");
  const joined = JSON.stringify(s);
  ok(!joined.includes(FIELD_GUIDE_GUARD_SENTENCE) && !joined.includes(`<<<${FIELD_GUIDE_MARKER}`),
    "IDS AND COUNTS ONLY — no block text enters the stored record or the REST payload");
  ok(summarizeKnowledge({}) === null, "nothing injected -> no receipt at all");
  ok(summarizeKnowledge({ skillsBlock: "x" }).fieldGuideSections === undefined,
    "a path that carries no guide reports NOTHING, not an invented empty list");
}

// --- B5: the log line grows without breaking the wordings the live drivers match on ---
{
  const lines = [];
  const log = (s) => lines.push(s);
  logKnowledgeInjection({ skillsBlock: "a", memoryBlock: "b" }, log);
  ok(lines[0] === "Knowledge injected: skills + memories", `the pre-existing wording is byte-identical (got "${lines[0]}")`);
  lines.length = 0;
  logKnowledgeInjection({ skillsBlock: "a", memoryBlock: "b", fieldGuideBlock: guide.block }, log);
  ok(lines[0] === "Knowledge injected: skills + memories + field guide", `the guide is appended (got "${lines[0]}")`);
  lines.length = 0;
  logKnowledgeInjection({ fieldGuideBlock: guide.block }, log);
  ok(lines[0] === "Knowledge injected: field guide", `a guide-only run says so (got "${lines[0]}")`);
  lines.length = 0;
  ok(logKnowledgeInjection({}, log) === null && lines.length === 0, "nothing injected -> no line emitted");
}

/* =====================================================================================
 * R — BEHAVIOUR: the PR review prompt
 * ===================================================================================*/
{
  const reviewGuide = await resolveFieldGuideBlock({ audience: "review", text: "manifest.yml resolver permissions scope" });
  ok(reviewGuide.block.length > 0, "control: the review audience selects a non-empty guide");
  ok(reviewGuide.budget === fieldGuideBudget("review"), "…on the review budget row");

  const args = {
    pr: { number: 7, title: "widen the manifest scopes", author: "a", state: "open", headSha: "abc", sourceBranch: "f", targetBranch: "main", body: "b" },
    diff: { files: [{ path: "manifest.yml", status: "modified", additions: 3, deletions: 0, patch: "+ read:jira-work" }], truncated: false },
    comments: [],
    repo: "o/r",
  };
  const withGuide = buildReviewPrompt({ ...args, fieldGuideBlock: reviewGuide.block });
  const without = buildReviewPrompt(args);

  ok(withGuide.system.includes(`<<<${FIELD_GUIDE_MARKER}`), "review: the guide lands in the SYSTEM message");
  ok(!withGuide.user.includes(`<<<${FIELD_GUIDE_MARKER}`), "review: never in the user message, which is the untrusted diff");
  ok(withGuide.user.includes(`<<<${PR_FENCE}`), "review: the diff is still fenced as untrusted data");
  ok(withGuide.system.indexOf(`<<<${FIELD_GUIDE_MARKER}`) > 0,
    "review: the guide comes AFTER the review instructions, in the cacheable stable prefix");
  ok(withGuide.system.startsWith(without.system),
    "review: the guide is APPENDED to the existing system prompt — the cached prefix is not rewritten");
  ok(without.system === without.system.trim() && !without.system.includes("Field Guide"),
    "review: with no guide the system prompt is byte-identical to what it always was");
  ok(withGuide.user === without.user, "review: the user message is untouched either way");
  ok(buildReviewPrompt({ ...args, fieldGuideBlock: "   " }).system === without.system,
    "review: a whitespace-only guide leaves no empty heading behind");
}

/* =====================================================================================
 * D — the admin's switch reaches every surface, not just the one that was tested
 * ===================================================================================*/
{
  await saveKnowledgeSettings({ disabled: KNOWN_PACK_IDS });
  for (const audience of ["codegen", "fix", "validator", "agent", "va", "coder", "review"]) {
    const g = await resolveFieldGuideBlock({ audience, text: "forge jira confluence resolver manifest" });
    ok(g.block === "" && g.sectionIds.length === 0, `${audience}: every pack off -> no block at all`);
  }
  await saveKnowledgeSettings({ disabled: [] });
  const back = await resolveFieldGuideBlock({ audience: "codegen", text: "forge resolver manifest" });
  ok(back.block.length > 0, "switching the packs back on restores the guide");
}

console.log(`\nfield-guide-surfaces: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
