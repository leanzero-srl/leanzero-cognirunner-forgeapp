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

console.log(`\ncoder resume params: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
