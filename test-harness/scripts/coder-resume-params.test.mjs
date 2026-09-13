/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-360 — ANSWERING A CONSENT TICKET MUST NOT TAKE A SIMULATED THREAD LIVE.
//
// `confirmCoderTicket` is the ONE producer of the resume turn, and it used to push
// that turn with only the message: no `simulation`. The engine re-assigns
// `record.simulation` from the parameter every turn, so a missing flag meant FALSE
// — the next turn ran with real Jira and real repository writes, and the user was
// never told the dry run had ended.
//
// This suite drives the REAL resolvers in src/index.js against the offline mocks and
// reads the queue the mock @forge/events records, so it pins the PUSHED PARAMS, not
// a source string:
//   1. startCoderTurn stores what the thread runs with,
//   2. the resume push carries simulation/connectionId from that record,
//   3. a confirm payload claiming simulation:false cannot flip it,
//   4. with no record at all the resume says NOTHING, leaving the engine's thread row
//      (the authority since F-360's engine half) to decide.
//
// Run: node scripts/coder-resume-params.test.mjs (auto-discovered by run-offline.mjs)

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi, pushed } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const OWNER = "acct-owner";

await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
await storage.set("COGNIRUNNER_OPENAI_KEY", "sk-test");
await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });
await storage.set("app_admins", [{ accountId: OWNER, role: "admin", scope: "all" }]);
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { handler } = await import("../../src/index.js");
const coder = await import("../../src/coder-engine.js");

const call = (functionKey, payload = {}, accountId = OWNER) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

const lastCoderPush = () => {
  for (let i = pushed.length - 1; i >= 0; i--) if (pushed[i]?.body?.taskType === "coder") return pushed[i].body.params;
  return null;
};

const ISSUE = "LZPT-77";

/* ===== 1. a SIMULATED turn records what it runs with ===== */
const started = await call("startCoderTurn", {
  issueKey: ISSUE, threadId: "t_sim", message: "have a look", simulation: true,
  connectionId: "conn-1", maxRounds: 3,
});
ok(started && started.success === true, `startCoderTurn accepted the turn (got ${JSON.stringify(started).slice(0, 200)})`);
{
  const p = lastCoderPush();
  ok(p && p.simulation === true, "the FIRST turn is pushed with simulation:true");
  const row = await storage.get(`coder_turn:${ISSUE}:t_sim`);
  ok(!!row && row.simulation === true && row.connectionId === "conn-1" && row.maxRounds === 3,
    `the turn params are stored for the resume to read (got ${JSON.stringify(row)})`);
}

/* ===== 2. the resume INHERITS simulation ===== */
// A pending ticket, in the shape the engine writes, answered with "skip" so nothing
// external is executed and the test stays offline.
const seedTicket = async (id, over = {}) => {
  await storage.set(coder.coderTicketKey(id), {
    ticketId: id, issueKey: ISSUE, threadId: "t_sim", ownerAccountId: OWNER,
    action: "commit_files", args: {}, argsPreview: {}, status: "pending",
    simulation: true, connectionId: "conn-1", ...over,
  });
  await storage.set(coder.coderThreadKey(ISSUE, "t_sim"), {
    issueKey: ISSUE, threadId: "t_sim", ownerAccountId: OWNER, messages: [],
    simulation: true, connectionId: "conn-1", pendingTicketId: id,
  });
};

await seedTicket("tkt_1");
const skipped = await call("confirmCoderTicket", { ticketId: "tkt_1", decision: "skip" });
ok(skipped && skipped.success === true, `the skip was recorded (got ${JSON.stringify(skipped).slice(0, 200)})`);
{
  const p = lastCoderPush();
  ok(p && p.simulation === true, `THE FINDING: the resume turn carries simulation:true (got ${JSON.stringify(p && p.simulation)})`);
  ok(p && p.connectionId === "conn-1", "…and the connection the thread was started against");
  ok(p && p.maxRounds === 3, "…and the round budget of the original turn");
  ok(p && p.message === skipped.resumeMessage, "…and the engine's own resume sentence, unchanged");
}

/* ===== 3. the confirm PAYLOAD cannot flip simulation ===== */
await seedTicket("tkt_2");
await call("confirmCoderTicket", { ticketId: "tkt_2", decision: "skip", simulation: false, connectionId: "conn-evil", maxRounds: 99 });
{
  const p = lastCoderPush();
  ok(p && p.simulation === true, "a caller-supplied simulation:false is IGNORED — the thread stays simulated");
  ok(p && p.connectionId === "conn-1", "a caller-supplied connectionId is ignored too");
  ok(p && p.maxRounds === 3, "…and so is a caller-supplied round budget");
}

/* ===== 4. no record at all → SAY NOTHING, so the engine's thread row decides ===== */
await storage.delete(`coder_turn:${ISSUE}:t_orphan`);
await storage.set(coder.coderTicketKey("tkt_3"), {
  ticketId: "tkt_3", issueKey: ISSUE, threadId: "t_orphan", ownerAccountId: OWNER,
  action: "commit_files", args: {}, argsPreview: {}, status: "pending", simulation: true,
});
const orphan = await call("confirmCoderTicket", { ticketId: "tkt_3", decision: "skip" });
ok(orphan && orphan.success === true, "a ticket whose thread row is gone is still answerable");
{
  const p = lastCoderPush();
  // The engine half of F-360 made the THREAD ROW the authority and refuses a mid-thread
  // flip by name, so the honest answer when nothing is known is to say nothing: a value
  // invented here would either take a simulated thread live or be refused as
  // "simulation-locked" on a live one.
  ok(p && !("simulation" in p), `an UNKNOWN mode pushes NO simulation flag, leaving the thread row as the authority (got ${JSON.stringify(p && p.simulation)})`);
}

/* ===== 5. a LIVE thread still resumes live (the fix is not a downgrade) ===== */
await call("startCoderTurn", { issueKey: ISSUE, threadId: "t_live", message: "go", simulation: false, connectionId: "conn-2" });
await storage.set(coder.coderTicketKey("tkt_4"), {
  ticketId: "tkt_4", issueKey: ISSUE, threadId: "t_live", ownerAccountId: OWNER,
  action: "commit_files", args: {}, argsPreview: {}, status: "pending", simulation: false, connectionId: "conn-2",
});
await call("confirmCoderTicket", { ticketId: "tkt_4", decision: "skip" });
{
  const p = lastCoderPush();
  ok(p && p.simulation === false, "a thread the owner started LIVE resumes live");
  ok(p && p.connectionId === "conn-2", "…against its own connection");
}

/* ===== 6. F-463 — THE PANEL TURN CARRIES ITS SKILL BINDING =====================
 *
 * `buildCoderKnowledge` (src/async-handler.js) has had a skills half since 1.4
 * commit 13b and NOTHING ever passed `skillIds` to it, so the Coder — the one surface
 * that writes code into somebody's repository — was the only agent in the product
 * that ran with no skills at all. The chain proven here is:
 *   startCoderTurn payload → the PUSHED task params → buildCoderKnowledge →
 *   knowledge.skillsBlock (and coder-engine.test.mjs proves a skillsBlock reaches the
 *   model payload). Every hop is the real code, none of it is a source grep.
 */
const { saveSkillInternal } = await import("../../src/skills.js");
const { __coderKnowledgeInternals } = await import("../../src/async-handler.js");

await saveSkillInternal(
  { id: "skill_house", name: "House style", category: "Other" },
  { instructions: "Two-space indent, never tabs." },
);
await saveSkillInternal(
  { id: "skill_adf", name: "ADF rules", category: "ADF & Formatting" },
  { instructions: "Comments are ADF documents." },
);
// Three more real skills, so the CAP is what drops the fifth rather than the
// existence check — a clamp proven by an id that does not exist proves nothing.
for (const id of ["skill_c", "skill_d", "skill_e"]) {
  await saveSkillInternal({ id, name: `Spare ${id}`, category: "Other" }, { instructions: `Spare ${id} text.` });
}

const withSkills = await call("startCoderTurn", {
  issueKey: ISSUE, threadId: "t_skills", message: "build it", simulation: true, connectionId: "conn-3",
  // six ids, one duplicated and one malformed: the clamp is the listener's ONE
  // normalizer, so four survive, in the author's order, de-duplicated.
  skillIds: ["skill_house", "skill_adf", "skill_house", "sk 3", "skill_c", "skill_d", "skill_e"],
});
ok(withSkills && withSkills.success === true, `a turn may bind skills (${JSON.stringify(withSkills).slice(0, 160)})`);
{
  const p = lastCoderPush();
  ok(Array.isArray(p && p.skillIds) && p.skillIds.length === 4,
    `F-463: the pushed params carry the binding, clamped to four (${JSON.stringify(p && p.skillIds)})`);
  ok(p.skillIds[0] === "skill_house" && p.skillIds[1] === "skill_adf" && !p.skillIds.includes("sk 3"),
    "…in the author's order, de-duplicated, with the malformed id dropped");
  const knowledge = await __coderKnowledgeInternals.buildCoderKnowledge(p);
  // `buildKnowledgeMessages` (src/agent-runner.js) is what wraps this in the
  // <<<SKILLS>>> fence, and coder-engine.test.mjs proves the fenced block reaches the
  // model payload — what F-463 was missing is this block existing at all.
  ok(typeof knowledge.skillsBlock === "string" && /### Skill: /.test(knowledge.skillsBlock),
    `…and the consumer turns them into a skills block (${String(knowledge.skillsBlock).slice(0, 60)})`);
  ok(/Two-space indent/.test(knowledge.skillsBlock) && /Comments are ADF documents/.test(knowledge.skillsBlock),
    "…carrying the bound skills' own text");
}

// A turn that binds NOTHING still sends nothing — the fix does not conjure knowledge.
await call("startCoderTurn", { issueKey: ISSUE, threadId: "t_noskills", message: "look", simulation: true });
{
  const p = lastCoderPush();
  ok(Array.isArray(p.skillIds) && p.skillIds.length === 0, "a turn with no binding pushes an empty list");
  const knowledge = await __coderKnowledgeInternals.buildCoderKnowledge(p);
  ok(knowledge.skillsBlock === undefined, "…and no skills block is built for it");
}

// An id that does not exist is REFUSED at the door, by name — a picker that silently
// binds nothing is a feature whose author believes it is on.
const unknownSkill = await call("startCoderTurn", {
  issueKey: ISSUE, threadId: "t_unknown", message: "go", skillIds: ["skill_house", "skill_ghost"],
});
ok(unknownSkill && unknownSkill.success === false && unknownSkill.reason === "unknown-skill",
  `an unknown skill id is refused by name (${JSON.stringify(unknownSkill).slice(0, 200)})`);
ok(/skill_ghost/.test(String(unknownSkill.error || "")), "…and the refusal names the id that does not exist");

// The RESUME inherits the binding, exactly as it inherits simulation and connectionId.
await storage.set(coder.coderTicketKey("tkt_5"), {
  ticketId: "tkt_5", issueKey: ISSUE, threadId: "t_skills", ownerAccountId: OWNER,
  action: "commit_files", args: {}, argsPreview: {}, status: "pending", simulation: true, connectionId: "conn-3",
});
await call("confirmCoderTicket", { ticketId: "tkt_5", decision: "skip" });
{
  const p = lastCoderPush();
  ok(Array.isArray(p && p.skillIds) && p.skillIds.length === 4,
    `the resume turn keeps the thread's skills (${JSON.stringify(p && p.skillIds)})`);
}

/* ===== 7. F-550 — ONE FIELD GUIDE PER THREAD, NOT PER TURN ====================
 *
 * `runCoderTurn` puts the knowledge messages inside the prompt prefix that
 * src/coder-engine.js promises is byte-identical "across the turns of one thread", and
 * the loop freezes its cache breakpoint at everything seeded on entry. The guide used to
 * be re-scored from THIS turn's message, so turn 2's prefix diverged at message index 1
 * and nothing of turn 1's prefix — the entire stored history included — could be a cache
 * hit. What is proven here is the selection half: the SAME thread returns the SAME bytes
 * no matter what the turn says, and anything new is handed back separately.
 */
{
  const THREAD = "t_guide";
  const key = coder.coderThreadKey(ISSUE, THREAD);
  const firstTurn = { issueKey: ISSUE, threadId: THREAD, message: "add a resolver to manifest.yml", skillIds: [] };

  // TURN 1 — no row yet, so the guide is chosen from this (the thread's first) message.
  const k1 = await __coderKnowledgeInternals.buildCoderKnowledge(firstTurn);
  ok(typeof k1.fieldGuideBlock === "string" && k1.fieldGuideBlock.includes("<<<FIELD_GUIDE"),
    `the first turn of a thread selects a field guide (${String(k1.fieldGuideBlock || "").slice(0, 40)})`);
  ok(Array.isArray(k1.fieldGuideSections) && k1.fieldGuideSections.length > 0,
    "…and reports the section ids the engine pins on the thread row");
  ok(k1.fieldGuideExtraBlock === undefined, "a first turn has nothing to ADD to a guide it just chose");

  // The engine writes those ids onto the row. Stand in for it, exactly as it does.
  await storage.set(key, {
    issueKey: ISSUE, threadId: THREAD, ownerAccountId: OWNER, messages: [{ role: "user", content: firstTurn.message }],
    turns: 1, fieldGuideSections: k1.fieldGuideSections,
  });

  // TURN 2 — a completely different subject. The STABLE block must not move one byte.
  const k2 = await __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: THREAD, message: "now fix the ADF in the comment and the Confluence page", skillIds: [],
  });
  ok(k2.fieldGuideBlock === k1.fieldGuideBlock,
    "F-550: a later turn re-emits the THREAD's guide byte-for-byte, whatever it is about");
  ok(JSON.stringify(k2.fieldGuideSections) === JSON.stringify(k1.fieldGuideSections),
    "…from the ids stored on the row, in the stored order");

  // …and whatever the new subject wanted comes back SEPARATELY, to be placed after the
  // prefix. It may be empty (the stable guide may already cover it); it may never be
  // folded into the stable block, and it may never repeat a section already in it.
  const extraIds = Array.isArray(k2.fieldGuideExtraSections) ? k2.fieldGuideExtraSections : [];
  ok(!extraIds.some((id) => k1.fieldGuideSections.includes(id)),
    "an added section is never one the stable block already carries");
  if (k2.fieldGuideExtraBlock) {
    ok(extraIds.length > 0 && !k2.fieldGuideBlock.includes(k2.fieldGuideExtraBlock),
      "the addition is its own block, outside the stable one");
  } else {
    ok(extraIds.length === 0, "no addition means no ids either");
  }

  // A third turn on the same words as turn 2 is still the same stable bytes — the point
  // is that NOTHING about a turn can move the prefix.
  const k3 = await __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: THREAD, message: "", skillIds: [],
  });
  ok(k3.fieldGuideBlock === k1.fieldGuideBlock, "…even an empty message re-emits the thread's guide unchanged");

  // A DIFFERENT thread on the same issue is free to choose differently: the guarantee is
  // per thread, and pinning it per issue would be a different (wrong) rule.
  const kOther = await __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: "t_guide_other", message: "write a Confluence page from this issue", skillIds: [],
  });
  ok(typeof kOther.fieldGuideBlock === "string" && kOther.fieldGuideBlock.length > 0,
    "a new thread selects its own guide");
}

console.log(`\ncoder resume params: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
