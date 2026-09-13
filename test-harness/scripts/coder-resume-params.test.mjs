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

  /* F-586 — AN EMPTY TOP-UP IS EXPLAINED, and it is not paid for twice.
   *
   * The extra selection used to run over the whole corpus and filter the thread's stored
   * ids out afterwards, so pass 1 spent the pinned share (0.4 × what was left of the
   * budget) re-buying sections the thread already carries verbatim and then discarded
   * them. The extra block could therefore come back empty with the room fully spent and
   * nothing on the turn saying which of the two reasons it was. The ids are now excluded
   * BEFORE selection and pass 1 is off, and the turn states the reason either way.
   */
  ok(k2.fieldGuideExtraReason === "new" || k2.fieldGuideExtraReason === "none-new" || k2.fieldGuideExtraReason === "budget",
    `every later turn states why its extra block is what it is (${k2.fieldGuideExtraReason})`);
  ok((k2.fieldGuideExtraBlock ? "new" : k2.fieldGuideExtraReason) === k2.fieldGuideExtraReason,
    "…and a block that exists is reported as `new`");
  // A turn with NO words has nothing to score, so nothing can be new — the healthy case,
  // and it must not be reported as a budget squeeze.
  ok(k3.fieldGuideExtraBlock === undefined && k3.fieldGuideExtraReason === "none-new",
    `THE FINDING: a turn that adds no sections says so (${k3.fieldGuideExtraReason})`);
  ok(k1.fieldGuideExtraReason === undefined,
    "a FIRST turn has no top-up at all, so it has no reason to state either");

  /* F-597 — AND THE REASON REACHES A SURFACE.
   *
   * Everything above was asserted against an in-memory object that nothing consumed:
   * `fieldGuideExtraReason` and `fieldGuideExtraSections` were set by the builder and
   * dropped, so `budget` was unreadable and the receipt named the PINNED sections while
   * staying silent about what the top-up actually put in front of the model. The same
   * `summarizeKnowledge` the turn record and the Coder task result are built from must
   * carry both — asserted here against the REAL builder's output, not a fixture. */
  {
    const { summarizeKnowledge } = await import("../../src/agent-runner.js");
    const receipt = summarizeKnowledge(k2);
    ok(receipt && receipt.fieldGuideExtra && receipt.fieldGuideExtra.reason === k2.fieldGuideExtraReason,
      `F-597: the turn's receipt carries the top-up REASON the builder decided (got ${JSON.stringify(receipt && receipt.fieldGuideExtra)})`);
    ok(JSON.stringify(receipt.fieldGuideExtra.sections) === JSON.stringify((k2.fieldGuideExtraSections || []).map(String)),
      "F-597: …and the sections the top-up added, beside the pinned ones");
    ok(summarizeKnowledge(k1).fieldGuideExtra === undefined,
      "F-597: a first turn's receipt reports no top-up rather than an invented empty one");
  }

  // A DIFFERENT thread on the same issue is free to choose differently: the guarantee is
  // per thread, and pinning it per issue would be a different (wrong) rule.
  const kOther = await __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: "t_guide_other", message: "write a Confluence page from this issue", skillIds: [],
  });
  ok(typeof kOther.fieldGuideBlock === "string" && kOther.fieldGuideBlock.length > 0,
    "a new thread selects its own guide");
}

/* ===== 8. F-574 — THE SKILLS AND MEMORY BLOCKS ARE PINNED PER THREAD TOO ======
 *
 * F-550 pinned the field guide and left `skillsBlock` and `memoryBlock` in the same cached
 * prefix, both re-derived every turn: the skills block from the delivery's ids (a skill can
 * be EDITED) and the memory block from the live store (a memory can be ADDED mid-thread).
 * Either one moves message index 1 of the prompt `runCoderTurn` promises is byte-identical
 * across the turns of a thread, and the whole thread — system prompt, knowledge and the
 * entire stored history — is re-billed at write price.
 *
 * Proven here against the REAL memory store (the offline mock KVS) and the REAL skills
 * store: a memory added BETWEEN two turns of one thread does not move a single byte of the
 * rendered prefix, and it still reaches the model — in the extra block that goes after the
 * history.
 */
{
  const THREAD = "t_pin";
  const key = coder.coderThreadKey(ISSUE, THREAD);
  const { saveMemoryCandidate } = await import("../../src/memories.js");
  const { buildKnowledgeMessages } = await import("../../src/agent-runner.js");

  await saveMemoryCandidate({ content: "Always rebase before opening a PR on this instance.", source: "user" });

  const turn1 = { issueKey: ISSUE, threadId: THREAD, message: "add a resolver", skillIds: ["skill_house"] };
  const k1 = await __coderKnowledgeInternals.buildCoderKnowledge(turn1);
  ok(typeof k1.skillsBlock === "string" && /Two-space indent/.test(k1.skillsBlock), "turn 1 gets its bound skill");
  ok(typeof k1.memoryBlock === "string" && /Always rebase/.test(k1.memoryBlock), "…and the memories that exist now");
  ok(k1.memoryExtraBlock === undefined && k1.skillsExtraBlock === undefined, "a first turn has nothing to ADD");

  // The engine writes the rendered bytes to the thread's PIN key — beside the transcript,
  // never inside it (F-487). Stand in for it exactly as it does (coder-engine.test.mjs
  // proves runCoderTurn is what writes this row).
  await storage.set(key, {
    issueKey: ISSUE, threadId: THREAD, ownerAccountId: OWNER,
    messages: [{ role: "user", content: turn1.message }], turns: 1,
    fieldGuideSections: k1.fieldGuideSections || [],
  });
  // F-578: the engine also stamps the epochs the builder handed it — `memoryEpoch` and
  // `skillEpoch` are what say the pinned bytes are still TRUE, and a pin without them is
  // rebuilt once. Stand in for the engine faithfully, stamps included.
  const pinRow = (k) => ({
    issueKey: ISSUE, threadId: THREAD,
    skillsBlock: k.skillsBlock || "", memoryBlock: k.memoryBlock || "",
    skillIds: k.skillIds || [], memoryCount: k.memoryCount || 0,
    memoryEpoch: k.memoryEpoch, skillEpoch: k.skillEpoch,
    at: new Date().toISOString(),
  });
  ok(typeof k1.memoryEpoch === "number" && typeof k1.skillEpoch === "string",
    `the builder hands the engine both epochs to stamp (${k1.memoryEpoch}, ${JSON.stringify(k1.skillEpoch)})`);
  await storage.set(coder.coderPinKey(ISSUE, THREAD), pinRow(k1));

  // BETWEEN THE TURNS: an admin adds a memory, and the user binds one more skill.
  await saveMemoryCandidate({ content: "Deploys need the production environment flag set.", source: "user" });

  const k2 = await __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: THREAD, message: "now the ADF", skillIds: ["skill_house", "skill_adf"],
  });
  ok(k2.memoryBlock === k1.memoryBlock, "THE FINDING: a memory added mid-thread does not touch the pinned memory block");
  ok(k2.skillsBlock === k1.skillsBlock, "…and the pinned skills block is replayed byte for byte");
  ok(!String(k2.memoryBlock || "").includes("production environment flag"),
    "the new memory is NOT folded into the block the prefix already carries");
  ok(typeof k2.memoryExtraBlock === "string" && /production environment flag/.test(k2.memoryExtraBlock),
    `…it comes back as the per-turn block instead (${String(k2.memoryExtraBlock || "").slice(0, 60)})`);
  ok(!/Always rebase/.test(String(k2.memoryExtraBlock || "")), "…carrying ONLY what the thread has not seen");
  ok(typeof k2.skillsExtraBlock === "string" && /Comments are ADF documents/.test(k2.skillsExtraBlock),
    "a newly bound skill takes the same route — after the history, not inside the prefix");
  ok(!/Two-space indent/.test(String(k2.skillsExtraBlock || "")), "…and never repeats a skill the prefix carries");
  ok(Array.isArray(k2.skillIds) && k2.skillIds.includes("skill_house") && k2.skillIds.includes("skill_adf"),
    `the receipt still names everything the model received (${JSON.stringify(k2.skillIds)})`);

  // THE BYTES THAT ACTUALLY GET BILLED: what `runCoderTurn` puts in the prefix is
  // `buildKnowledgeMessages(knowledge)`, so compare THAT, not the fields.
  ok(JSON.stringify(buildKnowledgeMessages(k2)) === JSON.stringify(buildKnowledgeMessages(k1)),
    "F-574: the rendered prefix knowledge of turn 2 is byte-identical to turn 1's");

  // A third turn that binds nothing new and sees no new memory is still the same bytes.
  const k3 = await __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: THREAD, message: "", skillIds: ["skill_house"],
  });
  ok(JSON.stringify(buildKnowledgeMessages(k3)) === JSON.stringify(buildKnowledgeMessages(k1)),
    "…and so is a turn that says nothing at all");
  ok(k3.skillsExtraBlock === undefined, "no new binding means no extra skills block");

  // A DIFFERENT thread gets today's memories in its OWN prefix: the pin is per thread.
  const kNew = await __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: "t_pin_other", message: "start fresh", skillIds: [],
  });
  ok(/production environment flag/.test(String(kNew.memoryBlock || "")),
    "a NEW thread starts from the memories that exist now, in its own stable block");
  ok(kNew.memoryExtraBlock === undefined, "…with nothing hanging off the back of it");
}

/* ===== 9. F-578 — A PIN IS REPLAYED ONLY WHILE ITS KNOWLEDGE IS STILL TRUE ==========
 *
 * F-574 pinned the RENDERED skills and memory bytes for the life of a thread (90 days) and
 * nothing invalidated them. So a memory the admin DELETED kept reaching the model on every
 * later turn of that thread, and an EDITED memory reached it TWICE: the stale line inside
 * the cached prefix and the corrected line in `memoryExtraBlock` after it — two versions of
 * one fact, with the wrong one in the position the model trusts most.
 *
 * The stores now each carry an epoch — `memoryEpoch` (src/memories.js, a counter its ONE
 * writer bumps on a delete/edit/injection switch and NOT on an add) and `skillEpochFor`
 * (src/skills.js, derived from the index rows of the pinned ids) — and the pin records both.
 * Proven here against the REAL stores, on the three cases the finding names:
 *   delete  → the next turn's PREFIX no longer carries the line, anywhere;
 *   edit    → the corrected line appears exactly ONCE;
 *   neither → the bytes do not move (F-574 still holds, and an ADD is still not a move).
 */
{
  const THREAD = "t_epoch";
  const { buildKnowledgeMessages } = await import("../../src/agent-runner.js");
  const { saveMemoryCandidate, loadMemories, saveMemories } = await import("../../src/memories.js");

  const STALE = "The staging deploy URL is https://old.staging.invalid for this instance.";
  const FIXED = "The staging deploy URL is https://new.staging.invalid for this instance.";
  const added = await saveMemoryCandidate({ content: STALE, source: "user" });
  const staleId = (added && added.id) || null;
  ok(!!staleId, `the memory under test is in the real store (${staleId})`);

  const pinIt = async (k) => {
    await storage.set(coder.coderPinKey(ISSUE, THREAD), {
      issueKey: ISSUE, threadId: THREAD,
      skillsBlock: k.skillsBlock || "", memoryBlock: k.memoryBlock || "",
      skillIds: k.skillIds || [], memoryCount: k.memoryCount || 0,
      memoryEpoch: k.memoryEpoch, skillEpoch: k.skillEpoch,
      at: new Date().toISOString(),
    });
  };
  const turn = (message) => __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: THREAD, message, skillIds: ["skill_house"],
  });

  await storage.set(coder.coderThreadKey(ISSUE, THREAD), {
    issueKey: ISSUE, threadId: THREAD, ownerAccountId: OWNER,
    messages: [{ role: "user", content: "turn one" }], turns: 1,
  });
  const e1 = await turn("turn one");
  ok(/old\.staging\.invalid/.test(String(e1.memoryBlock || "")), "turn 1 pins a block carrying the memory");
  await pinIt(e1);

  // NOTHING CHANGED — the F-574 promise, still kept.
  const e2 = await turn("turn two");
  ok(e2.repin === undefined, "an unchanged store does not invalidate the pin");
  ok(JSON.stringify(buildKnowledgeMessages(e2)) === JSON.stringify(buildKnowledgeMessages(e1)),
    "…and turn 2's rendered prefix knowledge is byte-identical to turn 1's");

  // AN ADD is still not a prefix move (it is the whole point of the extra block).
  await saveMemoryCandidate({ content: "Release notes live in the docs repo, not the app repo.", source: "user" });
  const e3 = await turn("turn three");
  ok(e3.repin === undefined, "ADDING a memory does not invalidate the pin");
  ok(JSON.stringify(buildKnowledgeMessages(e3)) === JSON.stringify(buildKnowledgeMessages(e1)),
    "…and the prefix still has not moved");
  ok(/Release notes live/.test(String(e3.memoryExtraBlock || "")), "…the addition arrives after the history instead");

  // THE DELETE. Through `saveMemories`, which is the single writer every admin resolver
  // (deleteMemory, updateMemory, the archive toggle) reaches KVS through.
  const afterDelete = (await loadMemories()).filter((m) => m.id !== staleId);
  await saveMemories(afterDelete);
  const e4 = await turn("turn four");
  ok(e4.repin === true, "THE FINDING: deleting a memory invalidates this thread's pin");
  ok(typeof e4.pinInvalidated === "string" && /memoryEpoch/.test(e4.pinInvalidated),
    `…and the reason names the epoch that moved (${e4.pinInvalidated})`);
  const rendered4 = JSON.stringify(buildKnowledgeMessages(e4));
  ok(!/old\.staging\.invalid/.test(rendered4),
    "…the deleted memory is gone from the PREFIX, not merely contradicted after it");
  ok(!/old\.staging\.invalid/.test(JSON.stringify(e4)),
    "…and from every other block of the turn");
  ok(/Release notes live/.test(String(e4.memoryBlock || "")),
    "…while the rebuilt block carries what the store says TODAY");
  ok(e4.memoryExtraBlock === undefined, "…with nothing duplicated after it");
  await pinIt(e4);

  // THE EDIT. Same single writer; the row's content changes and its id does not.
  const rows = await loadMemories();
  const target = rows.find((m) => /Release notes live/.test(String(m.content || "")));
  ok(!!target, "the row about to be edited is in the store");
  await saveMemories(rows.map((m) => (m.id === target.id
    ? { ...m, content: FIXED, updatedAt: new Date().toISOString() }
    : m)));
  const e5 = await turn("turn five");
  ok(e5.repin === true, "editing a memory invalidates the pin too");
  const rendered5 = JSON.stringify(buildKnowledgeMessages(e5));
  ok(!/Release notes live/.test(rendered5), "…the stale wording is gone");
  const hits = rendered5.split("new.staging.invalid").length - 1;
  ok(hits === 1, `THE FINDING: the corrected line reaches the model exactly ONCE (${hits})`);
  await pinIt(e5);

  // A SKILL edited mid-thread takes the same route — its epoch is derived, not counted, so
  // it covers the delete path in src/index.js as well as the save path in src/skills.js.
  const e6 = await turn("turn six");
  ok(e6.repin === undefined, "…and an untouched skill keeps the pin alive");
  await saveSkillInternal(
    { id: "skill_house", name: "House style", category: "Other" },
    { instructions: "Four-space indent now, and never tabs.", examples: "" },
  );
  const e7 = await turn("turn seven");
  ok(e7.repin === true, "editing a PINNED skill invalidates the pin");
  ok(/Four-space indent/.test(String(e7.skillsBlock || "")) && !/Two-space indent/.test(JSON.stringify(e7)),
    "…and the turn carries the edited skill, once, in the prefix");
}

/* ===== 10. F-593 — A STORAGE BLIP IS NOT A KNOWLEDGE CHANGE ========================
 *
 * F-578 wrote, in three docblocks, "a null epoch means cannot tell, and cannot-tell
 * replays… a storage hiccup must never move a prompt prefix". `memoryEpoch()` then
 * swallowed its own read error and answered `0` — a LEGITIMATE epoch — so the branch those
 * comments describe could not be reached by the fault it was written for. On an instance at
 * epoch 5 one transient KVS read fault read as `5 → 0`: the pin was dropped, the thread's
 * whole stored history was re-billed at write price, the pin was re-stamped at `0`, and the
 * NEXT turn read `5` again and moved the prefix a second time — twice, for a memory edit
 * that never happened, with the turn log blaming the admin.
 *
 * Proven here against the real store, on the fault itself and on the two things around it:
 * the reader distinguishes "could not read" from "nothing has ever been deleted", the
 * builder keeps the pin on a fault, and a bump that cannot READ the counter does not WRITE
 * a broken one (`null + 1` is `NaN`, which would invalidate every pin on the instance for
 * ever after).
 */
{
  const THREAD = "t_epoch_blip";
  const { memoryEpoch, MEMORY_EPOCH_KEY, loadMemories, saveMemories, saveMemoryCandidate } =
    await import("../../src/memories.js");
  const { buildKnowledgeMessages } = await import("../../src/agent-runner.js");
  const failEpochRead = () => storage.__failGetWhen((key) => key === MEMORY_EPOCH_KEY);

  // THE READER, on its own. An absent or zero counter is a READING; a fault is not.
  const settled = await memoryEpoch();
  ok(typeof settled === "number", `the epoch reads as a number when the store answers (${settled})`);
  failEpochRead();
  ok((await memoryEpoch()) === null, "THE FINDING: a read fault answers null — 'cannot tell' — and never 0");
  ok((await memoryEpoch()) === settled, "…and the very next read is the real value again");

  // THE BUILDER. Turn 1 pins; turn 2 hits the blip.
  await storage.set(coder.coderThreadKey(ISSUE, THREAD), {
    issueKey: ISSUE, threadId: THREAD, ownerAccountId: OWNER,
    messages: [{ role: "user", content: "turn one" }], turns: 1,
  });
  const turn = (message) => __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: THREAD, message, skillIds: ["skill_house"],
  });
  const b1 = await turn("turn one");
  ok(typeof b1.memoryEpoch === "number", `turn 1 stamps the epoch it rendered under (${b1.memoryEpoch})`);
  await storage.set(coder.coderPinKey(ISSUE, THREAD), {
    issueKey: ISSUE, threadId: THREAD,
    skillsBlock: b1.skillsBlock || "", memoryBlock: b1.memoryBlock || "",
    skillIds: b1.skillIds || [], memoryCount: b1.memoryCount || 0,
    memoryEpoch: b1.memoryEpoch, skillEpoch: b1.skillEpoch, at: new Date().toISOString(),
  });

  failEpochRead();
  const b2 = await turn("turn two");
  ok(b2.repin === undefined && b2.pinInvalidated === undefined,
    `THE FINDING: a blip on the epoch read KEEPS the pin (repin=${b2.repin}, reason=${b2.pinInvalidated})`);
  ok(JSON.stringify(buildKnowledgeMessages(b2)) === JSON.stringify(buildKnowledgeMessages(b1)),
    "…and the prompt prefix does not move");
  ok(b2.memoryEpoch === undefined, "…an epoch that was never read is not stamped onto the pin either");

  // AND THE TURN AFTER THE BLIP is ordinary — the pin was never re-stamped at 0, so there
  // is no second prefix move chasing the first.
  const b3 = await turn("turn three");
  ok(b3.repin === undefined, "the turn after the blip does not invalidate either");
  ok(Number(b3.memoryEpoch) === settled, `…and stamps the store's real epoch again (${b3.memoryEpoch})`);

  // THE WRITER. A bump that cannot read the counter leaves it alone rather than storing NaN.
  await saveMemoryCandidate({ content: "Blip probe: the CI runner image is pinned to 22.04.", source: "user" });
  const before = storage.__raw(MEMORY_EPOCH_KEY);
  const rows = await loadMemories();
  failEpochRead();
  await saveMemories(rows.slice(0, -1));
  const after = storage.__raw(MEMORY_EPOCH_KEY);
  ok(after === before, `an unreadable counter is not advanced (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
  ok(Number.isFinite(Number(await memoryEpoch())),
    "…and the epoch is still a readable number, not NaN, for every thread on the instance");
}

/* ===== 11. F-594 — A REBUILD MAY NOT SILENTLY STRIP A THREAD'S SKILLS ===============
 *
 * The F-578 rebuild had no fallback to the pin: with `ids.length === 0` the skills branch
 * never ran, `out.skillsBlock` was never set, and the engine overwrote the pin with an
 * empty skills block. Skill selection is per-viewer localStorage and the backend stores no
 * per-thread binding, so an empty `skillIds` on a later turn of the same thread is the
 * ORDINARY case — a second browser, cleared site data, or a colleague continuing the
 * thread. One unrelated memory delete anywhere on the instance was therefore enough to
 * strip a thread's skills for good, mid-conversation, with the turn log saying only "the
 * prompt prefix moves once".
 *
 * Both directions are proven: the absent selection keeps the pin's skills, and an EXPLICIT
 * empty selection still clears them.
 */
{
  const { loadMemories, saveMemories, saveMemoryCandidate } = await import("../../src/memories.js");
  const pinFor = async (thread, k) => storage.set(coder.coderPinKey(ISSUE, thread), {
    issueKey: ISSUE, threadId: thread,
    skillsBlock: k.skillsBlock || "", memoryBlock: k.memoryBlock || "",
    skillIds: k.skillIds || [], memoryCount: k.memoryCount || 0,
    memoryEpoch: k.memoryEpoch, skillEpoch: k.skillEpoch, at: new Date().toISOString(),
  });
  // Bump the MEMORY epoch — the invalidation this finding rides in on is always about the
  // other store, which is exactly why it must not touch this thread's skills.
  const bumpMemories = async () => {
    await saveMemoryCandidate({ content: `Rebuild probe ${Math.random().toString(36).slice(2)} for the epoch bump.`, source: "user" });
    const rows = await loadMemories();
    await saveMemories(rows.slice(0, -1));
  };
  const build = (thread, extra) => __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: thread, message: "carry on", ...extra,
  });

  /* --- the absent selection --- */
  const KEEP = "t_skill_keep";
  await storage.set(coder.coderThreadKey(ISSUE, KEEP), {
    issueKey: ISSUE, threadId: KEEP, ownerAccountId: OWNER,
    messages: [{ role: "user", content: "build me a resolver" }], turns: 1,
  });
  const s1 = await build(KEEP, { skillIds: ["skill_house"], message: "build me a resolver" });
  ok(Array.isArray(s1.skillIds) && s1.skillIds.includes("skill_house") && !!s1.skillsBlock,
    "turn 1 binds a skill and renders it into the thread's block");
  await pinFor(KEEP, s1);

  await bumpMemories();
  const s2 = await build(KEEP, { skillIds: [] });
  ok(s2.repin === true, "an unrelated memory delete still invalidates the pin (F-578 is intact)");
  ok(Array.isArray(s2.skillIds) && s2.skillIds.includes("skill_house"),
    `THE FINDING: the rebuild keeps the pin's skills when the turn carries no selection (${JSON.stringify(s2.skillIds)})`);
  ok(typeof s2.skillsBlock === "string" && /indent/.test(s2.skillsBlock),
    "…and re-renders them INTO the prefix, so the re-pin cannot store an empty skills block");
  ok(s2.skillsExtraBlock === undefined, "…with nothing hanging off the back of a rebuilt prefix");

  // And the pin the engine would now write still carries them on the turn after.
  await pinFor(KEEP, s2);
  const s3 = await build(KEEP, { skillIds: [] });
  ok(s3.repin === undefined && /indent/.test(String(s3.skillsBlock || "")),
    "the next turn replays a pin that still has its skills");

  /* --- the explicit clear --- */
  const DROP = "t_skill_drop";
  await storage.set(coder.coderThreadKey(ISSUE, DROP), {
    issueKey: ISSUE, threadId: DROP, ownerAccountId: OWNER,
    messages: [{ role: "user", content: "build me a resolver" }], turns: 1,
  });
  const d1 = await build(DROP, { skillIds: ["skill_house"], message: "build me a resolver" });
  await pinFor(DROP, d1);
  await bumpMemories();
  const d2 = await build(DROP, { skillIds: [], skillIdsExplicit: true });
  ok(d2.repin === true, "the explicit turn rebuilds too");
  ok(!d2.skillsBlock && (!d2.skillIds || d2.skillIds.length === 0),
    `a turn that MEANS the empty list still clears the thread's skills (${JSON.stringify(d2.skillIds)})`);
}

/* ===== 12. F-598 — AN EPOCH BUMP IS A TRIGGER, NOT A VERDICT =======================
 *
 * The memory epoch is instance-GLOBAL; `buildMemoryBlock` is project-SCOPED. So the counter
 * could only ever say "something in the store changed", never "something this thread
 * carries changed" — and a cap-200 eviction or a prune in an unrelated project invalidated
 * every Coder pin on the instance, in every project. With `autoCapture` on and a full store
 * that is one eviction per captured lesson, each one re-pinning every live thread and
 * re-billing its whole stored history at write price, for a memory no thread's block ever
 * contained: F-574's benefit cancelled precisely on the busiest instances.
 *
 * A bump now costs one RE-RENDER and the rendered bytes decide. Proven on the pair that
 * matters — the write this thread cannot see keeps the pin, the write it CAN see drops it.
 */
{
  const { loadMemories, saveMemories, saveMemoryCandidate } = await import("../../src/memories.js");
  const { buildKnowledgeMessages } = await import("../../src/agent-runner.js");
  const THREAD = "t_project_scope";

  // ONE memory this project's block carries, and one it cannot: `buildMemoryBlock` admits a
  // row only when it is unscoped or scoped to THIS project.
  const MINE = "The LZPT deploy job needs the release label before it will run.";
  const THEIRS = "The OTHER project keeps its runbooks in Confluence, not the repo.";
  const mine = await saveMemoryCandidate({ content: MINE, source: "user" });
  await saveMemoryCandidate({ content: THEIRS, source: "user", projectKey: "OTHER" });

  await storage.set(coder.coderThreadKey(ISSUE, THREAD), {
    issueKey: ISSUE, threadId: THREAD, ownerAccountId: OWNER,
    messages: [{ role: "user", content: "turn one" }], turns: 1,
  });
  const turn = (message) => __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: THREAD, message, skillIds: ["skill_house"],
  });
  const pinIt = async (k) => storage.set(coder.coderPinKey(ISSUE, THREAD), {
    issueKey: ISSUE, threadId: THREAD,
    skillsBlock: k.skillsBlock || "", memoryBlock: k.memoryBlock || "",
    skillIds: k.skillIds || [], memoryCount: k.memoryCount || 0,
    memoryEpoch: k.memoryEpoch, skillEpoch: k.skillEpoch, at: new Date().toISOString(),
  });

  const p1 = await turn("turn one");
  ok(p1.memoryBlock.includes(MINE), "turn 1's block carries this project's memory");
  ok(!p1.memoryBlock.includes(THEIRS), "…and not the other project's — the block is project-scoped");
  await pinIt(p1);

  /* --- the write this thread cannot see --- */
  const rows = await loadMemories();
  const theirs = rows.find((m) => m.content === THEIRS);
  ok(!!theirs, "the other project's memory is in the store");
  await saveMemories(rows.filter((m) => m.id !== theirs.id));
  const p2 = await turn("turn two");
  ok(p2.repin === undefined && p2.pinInvalidated === undefined,
    `THE FINDING: a delete in another project does NOT invalidate this thread's pin (repin=${p2.repin})`);
  ok(p2.pinEpochVerified === true,
    "…the epoch moved, the block was re-rendered and matched, and the turn says so for the re-stamp");
  ok(JSON.stringify(buildKnowledgeMessages(p2)) === JSON.stringify(buildKnowledgeMessages(p1)),
    "…and the prompt prefix is byte-identical");

  /* --- the write it CAN see --- */
  const rows2 = await loadMemories();
  await saveMemories(rows2.filter((m) => m.id !== mine.id));
  const p3 = await turn("turn three");
  ok(p3.repin === true, "deleting a memory the thread's own block carries still invalidates it");
  ok(typeof p3.pinInvalidated === "string" && /memory block changed/.test(p3.pinInvalidated),
    `…and the reason names the block, not merely the counter (${p3.pinInvalidated})`);
  ok(!JSON.stringify(buildKnowledgeMessages(p3)).includes(MINE),
    "…the deleted memory is gone from the prefix");
  ok(p3.pinEpochVerified === undefined, "…and nothing claims the bytes were verified unchanged");
}

/* ===== 13. F-619 — TWO STORES, TWO VERDICTS: A MOVED MEMORY EPOCH MUST NOT SWALLOW
 *        THE SKILL CHECK =========================================================
 *
 * F-598 made the memory bump a TRIGGER (re-render, compare bytes, keep the pin when they
 * match) but left the skill comparison as the final `else if` of one chain. So any turn on
 * which the memory epoch had moved never evaluated the skill epoch at all: the memory arm
 * answered, `pinEpochVerified` re-stamped the pin, and the next memory write did it again.
 * On an instance where a memory is written most turns, a skill the admin DELETED replayed
 * verbatim for the life of the thread — the exact failure F-578 exists to prevent, reached
 * through a store that has nothing to do with skills.
 *
 * The arms are independent now. Proven on the three cases that separate them, plus a
 * negative control that re-runs the OLD chain over the same facts and shows it keeping the
 * pin the new code drops.
 */
{
  const { loadMemories, saveMemories, saveMemoryCandidate } = await import("../../src/memories.js");
  const { SKILL_INDEX_KEY } = await import("../../src/skills.js");
  const PIN_SKILL = "skill_f619";

  await saveSkillInternal(
    { id: PIN_SKILL, name: "Pinned F619", category: "Other" },
    { instructions: "The original pinned instruction." },
  );

  const pinFor = async (thread, k) => storage.set(coder.coderPinKey(ISSUE, thread), {
    issueKey: ISSUE, threadId: thread,
    skillsBlock: k.skillsBlock || "", memoryBlock: k.memoryBlock || "",
    skillIds: k.skillIds || [], memoryCount: k.memoryCount || 0,
    memoryEpoch: k.memoryEpoch, skillEpoch: k.skillEpoch, at: new Date().toISOString(),
  });
  const startThread = async (thread) => {
    await storage.set(coder.coderThreadKey(ISSUE, thread), {
      issueKey: ISSUE, threadId: thread, ownerAccountId: OWNER,
      messages: [{ role: "user", content: "turn one" }], turns: 1,
    });
    const k = await __coderKnowledgeInternals.buildCoderKnowledge({
      issueKey: ISSUE, threadId: thread, message: "turn one", skillIds: [PIN_SKILL],
    });
    await pinFor(thread, k);
    return k;
  };
  const turn = (thread) => __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: thread, message: "turn two", skillIds: [PIN_SKILL],
  });

  // A memory write this project's block CANNOT see: scoped to another project, so the
  // instance-wide epoch moves and the rendered LZPT block is byte-identical. This is the
  // ordinary churn F-598 stopped charging for — and the cover the skill arm hid behind.
  const bumpMemoryEpochOnly = async () => {
    const row = await saveMemoryCandidate({
      content: `F619 unrelated ${Math.random().toString(36).slice(2)} lives in another project.`,
      source: "user", projectKey: "OTHER",
    });
    const rows = await loadMemories();
    await saveMemories(rows.filter((m) => m.id !== row.id));
  };
  // The skill store, moved on its own: an EDIT (updatedAt) and a DELETE (the id leaves the
  // index) are the two ways `skillEpochFor` reports a change.
  const editPinnedSkill = async () => {
    await new Promise((r) => setTimeout(r, 2));
    await saveSkillInternal(
      { id: PIN_SKILL, name: "Pinned F619", category: "Other" },
      { instructions: "The EDITED instruction the thread must now see." },
    );
  };
  // A REAL delete, both halves: `deleteSkill` (src/index.js) drops the index row AND the
  // content record. Removing only the index row is not a delete — `fetchSkillsBlock` reads
  // `skill_repo:{id}` directly and would still render the skill's text.
  const { SKILL_PREFIX } = await import("../../src/skills.js");
  const deletePinnedSkill = async () => {
    const index = (await storage.get(SKILL_INDEX_KEY)) || [];
    await storage.set(SKILL_INDEX_KEY, index.filter((r) => r && r.id !== PIN_SKILL));
    await storage.delete(`${SKILL_PREFIX}${PIN_SKILL}`);
  };

  /* --- (a) BOTH epochs move in the same turn → rebuild, and the skill is the reason --- */
  {
    const T = "t_f619_both";
    const p1 = await startThread(T);
    ok(/The original pinned instruction/.test(String(p1.skillsBlock || "")),
      "F-619 (a): turn 1 pins the skill's rendered bytes");
    const pinnedBefore = await storage.get(coder.coderPinKey(ISSUE, T));

    await bumpMemoryEpochOnly();
    await editPinnedSkill();

    const p2 = await turn(T);
    ok(p2.repin === true,
      `THE FINDING: a moved memory epoch no longer swallows the skill check (repin=${p2.repin}, pinInvalidated=${p2.pinInvalidated})`);
    ok(typeof p2.pinInvalidated === "string" && /skillEpoch changed/.test(p2.pinInvalidated),
      `…and the verdict NAMES the skill store (${p2.pinInvalidated})`);
    ok(p2.pinEpochVerified === undefined,
      "…and nothing re-stamps a pin that is being rebuilt");
    ok(/The EDITED instruction/.test(String(p2.skillsBlock || "")) && !/The original pinned instruction/.test(String(p2.skillsBlock || "")),
      "…the rebuilt prefix carries the CURRENT skill text, not the pinned one");

    /* --- NEGATIVE CONTROL: the reverted chain, over the same facts --- */
    const liveMemoryEpoch = await (await import("../../src/memories.js")).memoryEpoch();
    const { skillEpochFor } = await import("../../src/skills.js");
    const liveSkillEpoch = await skillEpochFor([PIN_SKILL]);
    const liveMemoryText = (await (await import("../../src/memories.js")).buildMemoryBlock({ projectKey: "LZPT", capBytes: 4000 })).text;
    // F-598's chain, restored verbatim: memory first, skills only in the trailing else-if.
    const oldChain = () => {
      if (pinnedBefore.memoryEpoch === undefined || pinnedBefore.skillEpoch === undefined) return "rebuild";
      if (liveMemoryEpoch !== null && Number(pinnedBefore.memoryEpoch) !== Number(liveMemoryEpoch)) {
        return String(liveMemoryText) === String(pinnedBefore.memoryBlock || "") ? "keep" : "rebuild";
      }
      if (liveSkillEpoch !== null && String(pinnedBefore.skillEpoch) !== String(liveSkillEpoch)) return "rebuild";
      return "keep";
    };
    ok(Number(pinnedBefore.memoryEpoch) !== Number(liveMemoryEpoch) && String(pinnedBefore.skillEpoch) !== String(liveSkillEpoch),
      `…the control runs on the real facts: both epochs did move (${pinnedBefore.memoryEpoch}→${liveMemoryEpoch})`);
    ok(String(liveMemoryText) === String(pinnedBefore.memoryBlock || ""),
      "…with this project's memory block byte-identical, which is what let the memory arm answer");
    ok(oldChain() === "keep",
      "NEGATIVE CONTROL: the reverted chain KEEPS this pin — it never reaches the skill comparison");
  }

  /* --- (b) memory moves, bytes equal, skill stable → the pin is KEPT (F-598 intact) --- */
  {
    await saveSkillInternal(
      { id: PIN_SKILL, name: "Pinned F619", category: "Other" },
      { instructions: "The EDITED instruction the thread must now see." },
    );
    const T = "t_f619_mem_only";
    await startThread(T);
    await bumpMemoryEpochOnly();
    const p2 = await turn(T);
    ok(p2.repin === undefined && p2.pinInvalidated === undefined,
      `F-619 (b): an unrelated memory write with the skills stable still keeps the pin (repin=${p2.repin}, ${p2.pinInvalidated})`);
    ok(p2.pinEpochVerified === true,
      "…and still asks for the re-stamp, so the re-render is paid once and not every turn");
  }

  /* --- (c) memory STABLE, skill epoch moves → rebuild (the arm that was unreachable) --- */
  {
    const T = "t_f619_skill_only";
    await startThread(T);
    await deletePinnedSkill();
    const p2 = await turn(T);
    ok(p2.repin === true && /skillEpoch changed/.test(String(p2.pinInvalidated)),
      `F-619 (c): a DELETED pinned skill drops the pin on its own (${p2.pinInvalidated})`);
    ok(!/The EDITED instruction/.test(String(p2.skillsBlock || "")) && !/The original pinned instruction/.test(String(p2.skillsBlock || "")),
      "…and the deleted skill's instructions are gone from the prefix");
  }

  // Leave the store as this file found it: the sections after this one bind real skills.
  await saveSkillInternal(
    { id: PIN_SKILL, name: "Pinned F619", category: "Other" },
    { instructions: "The original pinned instruction." },
  );
}

/* ===== F-610 - A FOLLOW-UP TURN INHERITS THE THREAD'S SKILLS ==================
 *
 * F-594 taught `buildCoderKnowledge` to keep the pin's skills when a turn carries no
 * selection "unless the turn passes `skillIdsExplicit`" - but NOTHING produced that flag,
 * and `startCoderTurn` never read back the row `rememberCoderTurnParams` writes. So turn 2
 * from a second browser (the picker lives in the viewer's localStorage) pushed
 * `skillIds: []`, and the rebuild ran off the default set: the thread's skills vanished
 * mid-conversation with nothing naming the cause.
 *
 * These drive the REAL resolver and read the PUSHED params, so they pin behaviour and not
 * a source string: (1) turn 2 without skillIds keeps turn 1's ids, (2) turn 2 with an
 * explicit `[]` clears them, (3) a stored-params read fault degrades to the default set,
 * logs, and never throws.
 */
{
  const T = "t_f610";
  const first = await call("startCoderTurn", {
    issueKey: ISSUE, threadId: T, message: "turn one", simulation: true,
    skillIds: ["skill_house", "skill_adf"],
  });
  ok(first && first.success === true, `F-610: turn 1 binds two skills (${JSON.stringify(first).slice(0, 160)})`);
  {
    const p = lastCoderPush();
    ok(p.skillIds.join(",") === "skill_house,skill_adf", "...and pushes them");
    ok(p.skillIdsExplicit === true, "...flagged EXPLICIT, because the payload carried the key");
  }

  /* (1) turn 2 says nothing about skills - it inherits */
  await call("startCoderTurn", { issueKey: ISSUE, threadId: T, message: "turn two", simulation: true });
  {
    const p = lastCoderPush();
    ok(p.skillIds.join(",") === "skill_house,skill_adf",
      `THE FINDING: a turn with no selection inherits the thread's stored skills (${JSON.stringify(p.skillIds)})`);
    ok(p.skillIdsExplicit === false,
      "...and is NOT explicit, so the pin's ids remain the fallback behind it (F-594's arm)");
    const knowledge = await __coderKnowledgeInternals.buildCoderKnowledge(p);
    // By NAME, not by body text: an earlier section of this file edits skill_house's
    // instructions, and a test that pins yesterday's sentence tests the fixture.
    ok(typeof knowledge.skillsBlock === "string" && /### Skill: House style/.test(knowledge.skillsBlock)
      && /### Skill: ADF rules/.test(knowledge.skillsBlock),
      `...and the rebuilt block still carries BOTH skills (${String(knowledge.skillsBlock).slice(0, 80)})`);
  }

  /* (2) turn 3 says `[]` and means it */
  await call("startCoderTurn", { issueKey: ISSUE, threadId: T, message: "turn three", simulation: true, skillIds: [] });
  {
    const p = lastCoderPush();
    ok(Array.isArray(p.skillIds) && p.skillIds.length === 0, "an explicit empty list clears the binding");
    ok(p.skillIdsExplicit === true, "...and says so, so the re-pin drops the pinned skills instead of keeping them");
    const row = await storage.get(`coder_turn:${ISSUE}:${T}`);
    ok(row && Array.isArray(row.skillIds) && row.skillIds.length === 0,
      `...and the stored row is CLEARED, so turn 4 does not resurrect them (${JSON.stringify(row && row.skillIds)})`);
  }
  await call("startCoderTurn", { issueKey: ISSUE, threadId: T, message: "turn four", simulation: true });
  ok(lastCoderPush().skillIds.length === 0, "...turn 4, silent again, inherits the cleared binding");

  /* (3) the read FAILS OPEN */
  {
    const T2 = "t_f610_fault";
    await call("startCoderTurn", { issueKey: ISSUE, threadId: T2, message: "one", simulation: true, skillIds: ["skill_house"] });
    const realGet = storage.get.bind(storage);
    const warns = [];
    const realWarn = console.warn;
    console.warn = (...a) => { warns.push(a.join(" ")); };
    storage.get = async (k) => {
      if (String(k) === `coder_turn:${ISSUE}:${T2}`) throw new Error("kvs unavailable");
      return realGet(k);
    };
    let threw = null;
    let r = null;
    try {
      r = await call("startCoderTurn", { issueKey: ISSUE, threadId: T2, message: "two", simulation: true });
    } catch (e) { threw = e; }
    storage.get = realGet;
    console.warn = realWarn;
    ok(threw === null && r && r.success === true,
      `a stored-params read fault does not fail the turn (threw=${threw && threw.message})`);
    ok(lastCoderPush().skillIds.length === 0, "...it degrades to the default set (no inherited ids)");
    ok(warns.some((w) => /turn params unreadable/i.test(w)),
      `...and it is LOGGED, so a thread quietly losing its skills has a cause on the record (${JSON.stringify(warns).slice(0, 200)})`);
  }
}

/* ===== F-630 — AN EXPLICIT SKILL CHANGE IS OBEYED ON A PINNED THREAD ===============
 *
 * F-610 gave `skillIdsExplicit` a producer. The unbind was then REMEMBERED but never
 * OBEYED: the turn-params row was written `[]` while `buildCoderKnowledge`'s replay arm
 * refilled `out.skillsBlock` from the pin, turn after turn — the "dropping the pinned N"
 * branch sat INSIDE `if (verdict)` and only ran when the pin was already being invalidated
 * for an unrelated reason. Measured live on staging (thread t_f610_mu0a1b8f, 2026-09-13):
 * `coder_turn` held `[]` while `coder_pin` still held two skills and a 5604-byte block, and
 * the turn log still said "Knowledge injected: skills".
 *
 * The cut: an explicit set that DIFFERS from the pin's (set-compare) is a deliberate prefix
 * move — one more reason in the same F-578 verdict, so the rebuild and the F-615 INFO path
 * are the ones already built for it. Same ids, no move. Non-explicit, still inherits.
 */
{
  const T = "t_f630";
  const pinKey = coder.coderPinKey(ISSUE, T);
  const { reportCrossTurnCacheDefect } = await import("../../src/agent-runner.js");

  const build = (extra) => __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: T, message: "go", ...extra,
  });
  // Stand in for the engine's pin write, epoch stamps included (as section 8 does).
  const pinFrom = (k) => storage.set(pinKey, {
    issueKey: ISSUE, threadId: T,
    skillsBlock: k.skillsBlock || "", memoryBlock: k.memoryBlock || "",
    // F-631 — the engine pins BOTH lists (src/coder-engine.js): the applied receipt and
    // the ids the turn asked for. This stand-in must too, or it models a pin the product
    // no longer writes.
    skillIds: k.skillIds || [], requestedSkillIds: k.requestedSkillIds || k.skillIds || [],
    memoryCount: k.memoryCount || 0,
    memoryEpoch: k.memoryEpoch, skillEpoch: k.skillEpoch,
    at: new Date().toISOString(),
  });

  const base = await build({ skillIds: ["skill_house", "skill_adf"], skillIdsExplicit: true });
  ok(/### Skill: House style/.test(String(base.skillsBlock || "")) && /### Skill: ADF rules/.test(String(base.skillsBlock || "")),
    "F-630: turn 1 binds two skills and renders both");
  await pinFrom(base);

  /* (a) the turn says `[]` and means it — the pin is REBUILT, not replayed */
  {
    const k = await build({ skillIds: [], skillIdsExplicit: true });
    ok(/^skills changed by the turn: \[skill_house, skill_adf\]→\[\]$/.test(String(k.pinInvalidated || "")),
      `THE FINDING: an explicit unbind invalidates the pin on its own (${JSON.stringify(k.pinInvalidated)})`);
    ok(k.repin === true, "…and asks the engine to re-pin what this turn actually runs with");
    ok(!k.skillsBlock && !k.skillsExtraBlock,
      `…and NO skills reach the model, in the prefix or after it (${String(k.skillsBlock || k.skillsExtraBlock || "").slice(0, 60)})`);
    ok(!(k.skillIds || []).length, `…and the receipt names none (${JSON.stringify(k.skillIds)})`);
    ok(k.pinEpochVerified !== true, "…a pin being rebuilt is never also re-stamped");
    // F-615: the re-bill this causes is an INFO naming the cause, never the DEFECT WARN.
    const v = reportCrossTurnCacheDefect({
      provider: "managed", usage: { firstRoundCacheReadTokens: 0 },
      priorPrefixBytes: 60000, prefixReset: k.pinInvalidated,
    });
    ok(v && v.defect === false && /skills changed by the turn/.test(v.line),
      `…and the prefix move is reported as a deliberate one (${v && v.line ? v.line.slice(0, 70) : v})`);
    // The engine re-pins what the turn ran with: an empty skills pin.
    await pinFrom(k);
  }

  /* (b) a silent turn AFTER the unbind stays unbound — the pin no longer holds skills */
  {
    const k = await build({});
    ok(!k.pinInvalidated, `a non-explicit turn does not move the prefix again (${JSON.stringify(k.pinInvalidated)})`);
    ok(!k.skillsBlock && !k.skillsExtraBlock && !(k.skillIds || []).length,
      `…and inherits the CLEARED binding rather than resurrecting it (${JSON.stringify(k.skillIds)})`);
  }

  /* (c) a NARROWING change rebuilds with exactly what was asked for */
  await pinFrom(base);
  {
    const k = await build({ skillIds: ["skill_house"], skillIdsExplicit: true });
    ok(/skills changed by the turn: \[skill_house, skill_adf\]→\[skill_house\]/.test(String(k.pinInvalidated || "")),
      `dropping ONE of two is the same deliberate move (${JSON.stringify(k.pinInvalidated)})`);
    ok(/### Skill: House style/.test(String(k.skillsBlock || "")) && !/### Skill: ADF rules/.test(String(k.skillsBlock || "")),
      "…and the rebuilt prefix carries the kept skill and only it");
    ok(!/### Skill: ADF rules/.test(String(k.skillsExtraBlock || "")), "…with nothing hanging off the back of it either");
  }

  /* (d) re-sending the SAME set is not a change — set-compare, not order */
  await pinFrom(base);
  {
    const k = await build({ skillIds: ["skill_adf", "skill_house"], skillIdsExplicit: true });
    ok(!k.pinInvalidated && k.repin !== true,
      `re-sending the same ids in another order keeps the pin (${JSON.stringify(k.pinInvalidated)})`);
    ok(k.skillsBlock === base.skillsBlock, "…and replays the pinned bytes exactly, so the prefix does not move");
    ok(!k.skillsExtraBlock, "…and fetches nothing extra for ids the prefix already carries");
  }
}

/* ===== F-631 — THE COMPARE IS REQUESTED-vs-REQUESTED, NOT REQUESTED-vs-RENDERED =====
 *
 * F-630 set-compared the turn's REQUEST against `pinned.skillIds` — the APPLIED receipt
 * `fetchSkillsBlock` returns, which silently drops a DISABLED skill, a 9th id, or one too
 * large for the turn's budget. The picker keeps sending those ids, so `sameSkillSet` was
 * false on every turn: the pin was dropped and rebuilt forever, the rebuild produced the
 * identical applied set, and the whole prefix (field guide + skills + memories + the entire
 * stored history) was re-billed at write price every turn — through the F-615 INFO path, so
 * nothing ever warned.
 *
 * The pin now carries `requestedSkillIds` beside `skillIds` and the compare reads that one.
 * Proven on the cases that decide it: the disabled id (kept, turn after turn), a real
 * change (one rebuild, then kept), and a LEGACY pin with no requested list (at most one).
 */
{
  const T = "t_f631";
  const pinKey = coder.coderPinKey(ISSUE, T);
  // A skill the picker still holds and the renderer refuses. Disabled BEFORE the pin is
  // made, so the skill epoch (derived from the PINNED/applied ids) never moves and the only
  // thing that could invalidate the pin is the compare under test.
  await saveSkillInternal(
    { id: "skill_off", name: "Retired rules", category: "Other", enabled: false },
    { instructions: "This skill was disabled by an admin." },
  );
  const REQ = ["skill_house", "skill_off"];
  const build = (extra) => __coderKnowledgeInternals.buildCoderKnowledge({
    issueKey: ISSUE, threadId: T, message: "go", ...extra,
  });
  // The engine's pin write, both lists — mirrors src/coder-engine.js.
  const pinFrom = (k, over = {}) => storage.set(pinKey, {
    issueKey: ISSUE, threadId: T,
    skillsBlock: k.skillsBlock || "", memoryBlock: k.memoryBlock || "",
    skillIds: k.skillIds || [],
    requestedSkillIds: Array.isArray(k.requestedSkillIds) ? k.requestedSkillIds : (k.skillIds || []),
    memoryCount: k.memoryCount || 0,
    memoryEpoch: k.memoryEpoch, skillEpoch: k.skillEpoch,
    at: new Date().toISOString(), ...over,
  });

  const t1 = await build({ skillIds: REQ, skillIdsExplicit: true });
  ok(/### Skill: House style/.test(String(t1.skillsBlock || "")) && !/Retired rules/.test(String(t1.skillsBlock || "")),
    "F-631: the disabled skill is not rendered — the applied set is smaller than the request");
  ok(Array.isArray(t1.skillIds) && t1.skillIds.join(",") === "skill_house",
    `…and the receipt names only what reached the model (${JSON.stringify(t1.skillIds)})`);
  ok(Array.isArray(t1.requestedSkillIds) && t1.requestedSkillIds.join(",") === REQ.join(","),
    `THE CUT: the turn also reports what it ASKED for, for the engine to pin (${JSON.stringify(t1.requestedSkillIds)})`);
  await pinFrom(t1);

  /* (a) the same request, turn after turn — the pin is KEPT even though applied != requested */
  for (const n of [2, 3]) {
    const k = await build({ skillIds: REQ, skillIdsExplicit: true });
    ok(!k.pinInvalidated && k.repin !== true,
      `THE FINDING: turn ${n} with an unrenderable id in the picker keeps the pin (${JSON.stringify(k.pinInvalidated)})`);
    ok(k.skillsBlock === t1.skillsBlock, `…and replays the pinned bytes, so the prefix does not move (turn ${n})`);
    ok(!k.skillsExtraBlock, `…and fetches nothing extra for an id that can never render (turn ${n})`);
  }

  /* (b) a REAL change still rebuilds — once — and then settles */
  {
    const k = await build({ skillIds: ["skill_house", "skill_off", "skill_adf"], skillIdsExplicit: true });
    ok(k.repin === true && /skills changed by the turn: \[skill_house, skill_off\]→\[skill_house, skill_off, skill_adf\]/.test(String(k.pinInvalidated || "")),
      `binding one more skill is still a deliberate prefix move, named from the REQUESTED ids (${JSON.stringify(k.pinInvalidated)})`);
    ok(/### Skill: ADF rules/.test(String(k.skillsBlock || "")), "…and the rebuilt prefix carries the new skill");
    await pinFrom(k);
    const after = await build({ skillIds: ["skill_house", "skill_off", "skill_adf"], skillIdsExplicit: true });
    ok(!after.pinInvalidated && after.repin !== true,
      `…and the very next turn is stable again — one rebuild, not a loop (${JSON.stringify(after.pinInvalidated)})`);
  }

  /* (c) a LEGACY pin, written before this finding, costs AT MOST ONE rebuild */
  {
    await pinFrom(t1);
    const raw = await storage.get(pinKey);
    delete raw.requestedSkillIds;
    await storage.set(pinKey, raw);
    const first = await build({ skillIds: REQ, skillIdsExplicit: true });
    ok(first.repin === true, "a pin with no requested list falls back to the applied one, so this turn rebuilds (the old behaviour, once)");
    ok(Array.isArray(first.requestedSkillIds) && first.requestedSkillIds.join(",") === REQ.join(","),
      `…and the rebuild reports the REQUEST, which is what the engine pins (${JSON.stringify(first.requestedSkillIds)})`);
    await pinFrom(first);
    const second = await build({ skillIds: REQ, skillIdsExplicit: true });
    ok(!second.pinInvalidated && second.repin !== true,
      `…after which the thread is stable for good (${JSON.stringify(second.pinInvalidated)})`);
  }

  /* (d) an inheriting turn still inherits, and the pin's REQUEST is what it inherits */
  {
    const k = await build({});
    ok(!k.pinInvalidated && /### Skill: House style/.test(String(k.skillsBlock || "")),
      "a turn with no selection replays the pin untouched (F-610/F-594 intact)");
    ok(Array.isArray(k.requestedSkillIds) && k.requestedSkillIds.join(",") === REQ.join(","),
      `…and carries the pin's request forward, so a refresh cannot narrow it (${JSON.stringify(k.requestedSkillIds)})`);
  }
}

/* ===== F-636 — THE BYTES A REBUILD SENDS ARE THE BYTES THE NEXT TURN SENDS =========
 *
 * Measured live on staging twice (2026-09-14): the turn after a pin rebuild read ZERO
 * cached tokens and raised F-550's DEFECT WARN although it decided nothing — so a rebuild
 * cost the thread TWO full re-bills instead of the one its own INFO line promises. Two
 * causes were possible and they live in different files: the builder serialising a
 * rebuilt turn's blocks differently from the replayed ones (HERE), or the cache
 * breakpoints landing on volatile bytes (src/agent-runner.js, cut and proven in
 * coder-engine.test.mjs). It was the second.
 *
 * This half is the REGRESSION GUARD for the first, and it earns its place on its own
 * terms: the whole F-574/F-578 design rests on "a rebuild produces the prefix the next
 * turn replays", and nothing asserted it. The comparison is on
 * `buildKnowledgeMessages(...)` — the rendered messages, not the fields — because that is
 * what reaches the model, and an empty block that serialises as `""` on one path and as
 * absent on the other is invisible on the fields and fatal on the bytes.
 *
 * Three shapes, because they reach the rebuild by three different routes: skills kept,
 * skills explicitly dropped, and a legacy pin with no epoch stamps at all.
 */
{
  const { buildKnowledgeMessages } = await import("../../src/agent-runner.js");
  const { loadMemories, saveMemories, saveMemoryCandidate } = await import("../../src/memories.js");
  const bumpMemories = async () => {
    await saveMemoryCandidate({ content: `F-636 probe ${Math.random().toString(36).slice(2)} for the epoch bump.`, source: "user" });
    const rows = await loadMemories();
    await saveMemories(rows.slice(0, -1));
  };

  // The engine's pin write (src/coder-engine.js), including the two epoch stamps and the
  // `typeof === "string" ? … : ""` normalisation that was the first suspect.
  const pinFrom = (thread, k) => storage.set(coder.coderPinKey(ISSUE, thread), {
    issueKey: ISSUE, threadId: thread,
    skillsBlock: typeof k.skillsBlock === "string" ? k.skillsBlock : "",
    memoryBlock: typeof k.memoryBlock === "string" ? k.memoryBlock : "",
    skillIds: Array.isArray(k.skillIds) ? k.skillIds : [],
    requestedSkillIds: Array.isArray(k.requestedSkillIds) ? k.requestedSkillIds : (Array.isArray(k.skillIds) ? k.skillIds : []),
    memoryCount: Number(k.memoryCount) || 0,
    ...(k.memoryEpoch !== undefined ? { memoryEpoch: Number(k.memoryEpoch) || 0 } : {}),
    ...(k.skillEpoch !== undefined ? { skillEpoch: String(k.skillEpoch) } : {}),
    at: new Date().toISOString(),
  });

  const arm = async (thread, { bind, rebuildWith, legacy = false, label }) => {
    await storage.set(coder.coderThreadKey(ISSUE, thread), {
      issueKey: ISSUE, threadId: thread, ownerAccountId: OWNER,
      messages: [{ role: "user", content: "build me a resolver" }], turns: 1,
    });
    const build = (extra) => __coderKnowledgeInternals.buildCoderKnowledge({
      issueKey: ISSUE, threadId: thread, message: "carry on", ...extra,
    });
    const first = await build({ ...bind, message: "build me a resolver" });
    await pinFrom(thread, first);
    if (legacy) {
      // A pin written before F-578 — no epochs at all, which is its own route to a rebuild.
      const raw = await storage.get(coder.coderPinKey(ISSUE, thread));
      delete raw.memoryEpoch; delete raw.skillEpoch;
      await storage.set(coder.coderPinKey(ISSUE, thread), raw);
    } else {
      await bumpMemories();
    }
    const rebuild = await build(rebuildWith);
    ok(rebuild.repin === true, `F-636 ${label}: the turn rebuilds (${JSON.stringify(rebuild.pinInvalidated)})`);
    // What the engine writes from that rebuild is what the NEXT turn replays.
    await pinFrom(thread, rebuild);
    const next = await build({});
    ok(next.repin !== true, `F-636 ${label}: the turn after it decides nothing`);
    const a = JSON.stringify(buildKnowledgeMessages(rebuild));
    const b = JSON.stringify(buildKnowledgeMessages(next));
    ok(a === b, `F-636 ${label}: THE FINDING — the prefix a rebuild sends is byte-identical to the one the next turn replays (${a.length} vs ${b.length} bytes)`);
    // …and nothing of that turn's own is hiding inside the prefix instead of after it.
    ok(next.skillsExtraBlock === undefined,
      `F-636 ${label}: the replay carries no skills addition that belonged in the block`);
  };

  await arm("t_f636_keep", {
    label: "skills present",
    bind: { skillIds: ["skill_house"], skillIdsExplicit: true },
    // No selection on the wire: F-594 re-renders the pin's skills INTO the rebuilt prefix.
    rebuildWith: {},
  });
  await arm("t_f636_empty", {
    label: "skills empty",
    bind: { skillIds: ["skill_house"], skillIdsExplicit: true },
    // The live shape: an explicit unbind, which is what produced the measurement.
    rebuildWith: { skillIds: [], skillIdsExplicit: true },
  });
  await arm("t_f636_legacy", {
    label: "legacy pin",
    bind: { skillIds: ["skill_house"], skillIdsExplicit: true },
    rebuildWith: {},
    legacy: true,
  });
}

console.log(`\ncoder resume params: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
