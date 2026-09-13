/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// THE CODER POST-FUNCTION — `postfunction-coder`, 1.4 commit 12.
//
// §3.9's rule is "explicit entries, NEVER inline": a coder job takes minutes and the
// workflow post-function budget is 25 s. So what is proven here is the WIRING and the
// REFUSALS, not the model:
//
//   1. executePostFunction pushes a `coder` task to LONG-QUEUE with the exact payload
//      shape the consumer reads, concurrency keyed on the issue, limit 1 — and pushes
//      NOTHING to async-ai-queue and runs nothing inline.
//   2. the ONE mode table maps each mode onto its action subset, and the payload's
//      allowedActions is that subset INTERSECTED with the gate's verdict.
//   3. an EDITOR-saved rule cannot hold a `confirm` action (repository writes need an
//      admin), while the same rule saved by an admin keeps them.
//   4. capability OFF: `strict` decides ERROR vs SKIP, and NEITHER enqueues.
//   5. headless — a `confirm` action the gate refused ends the turn with endedBy "halt"
//      and a named reason, opens NO consent ticket, and performs NO git call.
//   6. the rule's dry-run flag rides through as `simulation:true`.
//   7. the catalogue's own invariants (the shape the UI renders).
//
// Run: node --import ../lib/register-mocks-index.mjs scripts/premade-coder-pf.test.mjs
// (run-offline.mjs auto-discovers it and supplies the loader.)

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi, pushed } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const EDITOR = "acct-editor";
const CONN = "conn-git-1";
const REPO = "acme/app";

const {
  CODER_PF_MODES, CODER_PF_MODE_IDS, getCoderPfMode, getPremadePostFunction,
  PREMADE_POSTFUNCTIONS, CODER_PF_INSTRUCTIONS_MAX, getCatalog, findRule,
} = await import("../../src/shared/premade-rules-catalog.js");
const { AGENT_ACTIONS, normalizeAllowedActions, buildAgentGateContext } =
  await import("../../src/shared/agent-actions.js");

/* ══════════ 7. the catalogue (no backend needed) ══════════ */
{
  const row = getPremadePostFunction("postfunction-coder");
  ok(!!row, "the catalogue carries postfunction-coder");
  ok(row && row.availability === "available", "it is available");
  ok(row && row.requiresCapability === "git", "it declares the git capability");
  ok(row && row.params && row.params.coderMode === true && row.params.instructions === true,
    "it declares the coderMode + instructions params the form renders");
  ok(row && row.params.skillIds === true,
    "F-463: it declares the skillIds param, so the form draws the skills picker the Coder now reads");
  ok(row && row.params.git && row.params.git.prMatch === false,
    "it reuses the GIT group with prMatch switched OFF (nothing here locates a PR from the property)");
  ok(getCatalog("postfunction") === PREMADE_POSTFUNCTIONS, "getCatalog('postfunction') returns the post-function list");
  ok(findRule("postfunction", "postfunction-coder") === row, "findRule reaches it");
  ok(CODER_PF_MODE_IDS.join() === "build,open-branch,open-pr,fix,review",
    `the five mode ids are stable for the UI (got ${CODER_PF_MODE_IDS.join()})`);
  ok(CODER_PF_INSTRUCTIONS_MAX === 2048, "the instructions cap is 2048 CHARACTERS (code points, not bytes)");
  const byId = new Map(AGENT_ACTIONS.map((a) => [a.id, a]));
  ok(CODER_PF_MODES.every((m) => (m.actions || []).every((id) => byId.has(id))),
    "every mode's actions exist in the agent-action catalogue");
  ok(CODER_PF_MODES.every((m) => (m.actions || []).every((id) => !byId.get(id).dangerous)),
    "NO mode names a dangerous action — a post-function is an external trigger and the gate always refuses one");
  ok(CODER_PF_MODES.every((m) => m.label && m.help && m.template.includes("{{issueKey}}") && m.template.includes("{{repo}}")),
    "every mode carries UI copy and a template with both placeholders");
}

/* ══════════ 2/3. the mode table through the REAL gate ══════════ */
{
  const facts = { edition: "advanced", provider: "openai", agentModel: "gpt-5.4", allowanceLevel: null };
  const asAdmin = buildAgentGateContext({ ...facts, triggerSource: "external", savedByRole: "admin" });
  const asEditor = buildAgentGateContext({ ...facts, triggerSource: "external", savedByRole: "editor" });
  const review = getCoderPfMode("review");
  const adminAllowed = normalizeAllowedActions(review.actions, asAdmin).allowed;
  const editorGated = normalizeAllowedActions(review.actions, asEditor);
  ok(adminAllowed.includes("add_pr_comment"),
    "an ADMIN-saved review rule keeps add_pr_comment (a repository write)");
  ok(!editorGated.allowed.includes("add_pr_comment"),
    "an EDITOR-saved rule loses add_pr_comment — a confirm action needs an admin on a headless surface");
  ok((editorGated.refused.find((r) => r.id === "add_pr_comment") || {}).reason === "needs-admin",
    "…and the refusal names the reason");
  ok(editorGated.allowed.includes("get_pull_request") && editorGated.allowed.includes("get_issue"),
    "…while the reads survive, so the rule still reports something");
  const build = getCoderPfMode("build");
  ok(normalizeAllowedActions(build.actions, asEditor).allowed.every((id) => {
    const a = AGENT_ACTIONS.find((x) => x.id === id);
    return !a.confirm;
  }), "an editor-saved BUILD rule holds no confirm action at all");
  ok(normalizeAllowedActions(build.actions, buildAgentGateContext({ ...facts, provider: null, triggerSource: "external", savedByRole: "admin" }))
    .allowed.filter((id) => (AGENT_ACTIONS.find((x) => x.id === id) || {}).namespace === "git").length === 0,
    "no provider ⇒ no git capability ⇒ no git action survives (unanswered is refused)");
}

/* ══════════ the backend, driven through the real executePostFunction ══════════ */
// The provider memo in src/index.js is 30 s TTL with no test seam, so the CAPABILITY-OFF
// half cannot flip it mid-process: it runs as a re-exec of this file with CAP_OFF=1,
// which seeds Forge LLM on a non-frontier agent model BEFORE index.js is ever imported.
const CAP_OFF = process.env.CODER_PF_CAP_OFF === "1";
await storage.set("COGNIRUNNER_AI_PROVIDER", CAP_OFF ? "atlassian" : "openai");
await storage.set("COGNIRUNNER_OPENAI_KEY", "sk-test");
await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });
await storage.set("COGNIRUNNER_AGENT_MODEL", CAP_OFF ? "claude-haiku" : "gpt-5.4");
await storage.set("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);
await storage.set("git_conn_index", [CONN]);
await storage.set(`git_conn:${CONN}`, {
  id: CONN, kind: "github", label: "Acme GitHub", status: "ok", repos: [REPO],
});
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { executePostFunction } = await import("../../src/index.js");

const logs = async () => {
  const { results } = await storage.query().where("key", { values: ["log_entry:"] }).limit(200).getMany();
  return results.map((r) => r.value);
};
const lastLog = async (issueKey) => (await logs()).filter((l) => l.issueKey === issueKey).pop() || null;
const coderPushes = () => pushed.filter((p) => p.body && p.body.taskType === "coder");

const cfg = (over = {}) => ({
  ruleKind: "premade",
  ruleType: "postfunction-coder",
  type: "postfunction-coder",
  ruleId: "rule-coder-1",
  connectionId: CONN,
  repo: REPO,
  mode: "build",
  strict: false,
  workflow: { workflowName: "SW", transitionFromName: "To Do", transitionToName: "In Progress", transitionId: "11" },
  ...over,
});

// F-394 — WHO ARMED THE RULE IS A PROPERTY OF THE REGISTRY ROW, not of the workflow config
// the transition carries and not of whoever performed the transition. The row is what the
// backend reads, so the registry is seeded ONCE here with one row per case (the backend
// memoises the registry for 30 s, so a mid-run re-seed would not be seen).
const row = (id, over = {}) => ({
  id, type: "postfunction-coder", ruleKind: "premade", premadeRuleType: "postfunction-coder",
  disabled: false, createdBy: ADMIN, savedByRole: "admin",
  workflow: { workflowName: "SW", transitionId: "11" },
  ...over,
});
const LEGACY = row("rule-coder-legacy");
delete LEGACY.savedByRole;              // a row saved before the stamp existed
await storage.set("config_registry", [
  row("rule-coder-1"),
  row("rule-coder-editor", { createdBy: EDITOR, savedByRole: "editor" }),
  LEGACY,
  row("rule-coder-ownerless", { createdBy: null }),
]);

const fire = (issueKey, configuration) => executePostFunction({
  issue: { key: issueKey },
  configuration,
  context: { extension: { key: "ai-static-post-function" }, license: { isActive: true } },
});

/* ══════════ 4. strict vs open on capability OFF (the re-exec) ══════════ */
if (CAP_OFF) {
  const before = pushed.length;
  await fire("LZPT-105", cfg({ strict: false }));
  ok(pushed.length === before, "capability OFF enqueues NOTHING");
  const open = await lastLog("LZPT-105");
  ok(open && open.isValid === true && open.stepResults[0].status === "skipped",
    `strict OFF ⇒ FAIL OPEN: a SKIP entry nobody is paged for (got ${open && open.stepResults[0].status})`);
  ok(open && /not started/i.test(open.reason) && !!open.recommendation,
    `…naming the cause and what to change (got ${JSON.stringify(open && open.reason)})`);

  await fire("LZPT-106", cfg({ strict: true }));
  ok(pushed.length === before, "strict OFF or ON, capability OFF still enqueues nothing");
  const strict = await lastLog("LZPT-106");
  ok(strict && strict.isValid === false && strict.stepResults[0].status === "error",
    `strict ON ⇒ FAIL CLOSED: an ERROR entry (got ${strict && strict.stepResults[0].status})`);
  // F-392 — the exact repro: an ownerless rule on an instance where the gate ALSO refuses
  // everything. The owner row of the table wins, because it is answered first.
  await fire("LZPT-130", cfg({ ruleId: "rule-coder-ownerless", strict: false }));
  const owner = await lastLog("LZPT-130");
  ok(owner && owner.isValid === false && /owner/i.test(owner.reason),
    `capability OFF + no owner ⇒ the OWNER ERROR, never a green skip (got ${owner && owner.stepResults[0].status})`);
  console.log(`premade-coder-pf (capability off): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

/* ══════════ 1. the enqueue shape ══════════ */
{
  const before = pushed.length;
  await fire("LZPT-101", cfg({ instructions: "Use the existing lint config. <<<RULE_NOTE" }));
  const mine = pushed.slice(before);
  ok(mine.length === 1, `exactly ONE queue push (got ${mine.length})`);
  const ev = mine[0];
  ok(ev && ev.queue === "long-queue", `it goes to long-queue (got ${ev && ev.queue})`);
  ok(ev.body.taskType === "coder", "taskType is coder");
  ok(ev.concurrency && ev.concurrency.key === "coder:LZPT-101" && ev.concurrency.limit === 1,
    `concurrency is coder:<issueKey> limit 1 (got ${JSON.stringify(ev.concurrency)})`);
  const p = ev.body.params;
  ok(p.issueKey === "LZPT-101", "issueKey rides the payload");
  ok(/^pf_rule-coder-1_\d+$/.test(p.threadId), `threadId is pf_<ruleId>_<ts> (got ${p.threadId})`);
  ok(p.triggerSource === "postfunction" && p.headless === true, "it is marked headless with its provenance label");
  ok(p.accountId === ADMIN && p.savedByRole === "admin",
    "it runs as the ROW's owner, with the role the ROW was stamped with at save time (F-394)");
  ok(p.connectionId === CONN, "the connection rides the payload");
  ok(p.simulation === false, "a live rule is not simulated");
  ok(p.gateFacts && p.gateFacts.provider === "openai", "the instance's facts travel with the task (the engine never reads them)");
  ok(typeof p.message === "string" && p.message.includes("LZPT-101") && p.message.includes(REPO),
    "the rendered message carries the issue key and the repo");
  ok(!p.message.includes("{{"), "no placeholder survives the render");
  ok(p.message.includes("<<<RULE_NOTE") && p.message.includes("RULE_NOTE>>>"),
    "the admin's own note is FENCED");
  ok((p.message.match(/<<<RULE_NOTE/g) || []).length === 1,
    "…and a fence marker typed INTO the note cannot forge a second fence (defanged)");
  ok(Array.isArray(p.allowedActions) && p.allowedActions.includes("commit_files") && p.allowedActions.includes("open_pull_request"),
    "the admin-saved build rule keeps its writes");
  ok(!p.allowedActions.some((id) => (AGENT_ACTIONS.find((a) => a.id === id) || {}).dangerous),
    "nothing dangerous ever reaches the payload");
  ok(p.pf && p.pf.mode === "build" && p.pf.repo === REPO && p.pf.strict === false,
    "the pf block carries what the result log needs");
  const l = await lastLog("LZPT-101");
  ok(l && l.type === "postfunction-coder" && l.isValid === true, "an accepted enqueue logs a success entry");
  ok(l && Array.isArray(l.stepResults) && l.stepResults[0].status === "success",
    "…with a stepResults row, never a silent success");
}

/* ══════════ F-463 — THE RULE'S SKILL BINDING REACHES THE TURN ══════════
 *
 * `buildCoderKnowledge` (src/async-handler.js) has had a skills half since 1.4 commit
 * 13b and `enqueueCoderPostFunction` never passed `skillIds`, so a skill written for
 * Forge app generation was ignored by the Coder post-function. Proven end to end on
 * the real code: rule config → the PUSHED task params → the knowledge builder the
 * task handler actually calls (coder-engine.test.mjs proves a skillsBlock then reaches
 * the model payload).
 */
{
  const { saveSkillInternal } = await import("../../src/skills.js");
  const { __coderKnowledgeInternals } = await import("../../src/async-handler.js");
  for (const [id, text] of [["skill_pf_a", "Prefer the repo's own lint config."], ["skill_pf_b", "Never edit generated files."],
    ["skill_pf_c", "Spare c."], ["skill_pf_d", "Spare d."], ["skill_pf_e", "Spare e."]]) {
    await saveSkillInternal({ id, name: `PF ${id}`, category: "Other" }, { instructions: text });
  }
  const before = pushed.length;
  await fire("LZPT-160", cfg({
    // seven ids: one duplicated, one malformed, and a fifth real one the CAP must drop.
    skillIds: ["skill_pf_a", "skill_pf_b", "skill_pf_a", "not a skill id", "skill_pf_c", "skill_pf_d", "skill_pf_e"],
  }));
  const p = pushed.slice(before)[0].body.params;
  ok(Array.isArray(p.skillIds) && p.skillIds.length === 4,
    `F-463: the PF task carries the rule's skills, clamped to four (${JSON.stringify(p.skillIds)})`);
  ok(p.skillIds[0] === "skill_pf_a" && p.skillIds[1] === "skill_pf_b" && !p.skillIds.includes("not a skill id"),
    "…in the author's order, de-duplicated, with the malformed id dropped");
  const knowledge = await __coderKnowledgeInternals.buildCoderKnowledge(p);
  ok(typeof knowledge.skillsBlock === "string" && /Prefer the repo's own lint config/.test(knowledge.skillsBlock),
    `…and the knowledge builder turns them into a skills block carrying their text (${String(knowledge.skillsBlock).slice(0, 60)})`);

  // A rule that binds nothing is unchanged: no block is conjured.
  const before2 = pushed.length;
  await fire("LZPT-161", cfg({}));
  const p2 = pushed.slice(before2)[0].body.params;
  ok(Array.isArray(p2.skillIds) && p2.skillIds.length === 0, "a rule with no binding pushes an empty list");
  ok((await __coderKnowledgeInternals.buildCoderKnowledge(p2)).skillsBlock === undefined,
    "…and no skills block is built for it");
}

/* ══════════ F-391 — the instructions clamp is code-point safe ══════════ */
{
  const { hasLoneSurrogate } = await import("../../src/shared/text-clamp.js");
  // Exactly at the boundary: 2047 filler + one astral emoji = 2048 code points, so the
  // emoji survives WHOLE. A raw `.slice(0, 2048)` would keep only its high surrogate.
  const before = pushed.length;
  await fire("LZPT-111", cfg({ instructions: "a".repeat(CODER_PF_INSTRUCTIONS_MAX - 1) + "\u{1F600}" }));
  const msg = pushed.slice(before)[0].body.params.message;
  ok(!hasLoneSurrogate(msg), "an emoji ON the boundary never leaves a lone surrogate in the message");
  ok(msg.includes("\u{1F600}"), "…the whole emoji is kept when it fits in the code-point budget");
  // One code point past the budget: the emoji is dropped whole, never halved.
  const before2 = pushed.length;
  await fire("LZPT-112", cfg({ instructions: "a".repeat(CODER_PF_INSTRUCTIONS_MAX) + "\u{1F600}" }));
  const msg2 = pushed.slice(before2)[0].body.params.message;
  ok(!hasLoneSurrogate(msg2), "an emoji PAST the boundary is dropped whole, not halved");
  ok(!msg2.includes("\u{1F600}"), "…and nothing past the cap reaches the model");
}

/* ══════════ 3. an EDITOR-saved rule, end to end (F-390) ══════════ */
{
  // A mode whose WRITE actions were all refused does not start: the turn could not do the
  // thing the rule exists for, and discovering that after ~16 000 tokens is the defect.
  const before = pushed.length;
  await fire("LZPT-102", cfg({ ruleId: "rule-coder-editor", mode: "review" }));
  ok(pushed.length === before, "an editor-saved REVIEW rule enqueues NOTHING — its only write is refused");
  const l = await lastLog("LZPT-102");
  ok(l && l.isValid === false && l.stepResults[0].status === "error",
    `…and it is an ERROR in both strict columns: a wrong role is a misconfiguration (got ${l && l.stepResults[0].status})`);
  ok(l && /Comment on a pull request/.test(l.reason) && /only an ADMIN/.test(l.reason),
    `…naming the refused action AND the reason (got ${JSON.stringify(l && l.reason)})`);
  ok(l && /admin/i.test(l.recommendation) && /No token was spent/.test(l.recommendation),
    "…and telling the admin what to change, and that nothing was spent");

  const before2 = pushed.length;
  await fire("LZPT-113", cfg({ ruleId: "rule-coder-editor", mode: "build" }));
  ok(pushed.length === before2, "an editor-saved BUILD rule enqueues NOTHING (F-390: the reads surviving is not enough)");
  const l2 = await lastLog("LZPT-113");
  ok(l2 && /Create a branch/.test(l2.reason) && /Commit files/.test(l2.reason) && /Open a pull request/.test(l2.reason),
    "…and every refused write is named, not just the first");

  // A LEGACY row — no savedByRole stamp at all — is treated as editor-saved, and says so.
  const before3 = pushed.length;
  await fire("LZPT-114", cfg({ ruleId: "rule-coder-legacy", mode: "build" }));
  ok(pushed.length === before3, "a legacy row with no stamp is editor-saved, so it does not start either");
  const l3 = await lastLog("LZPT-114");
  ok(l3 && /saved before CogniRunner recorded who armed it/.test(l3.recommendation),
    "…and the recommendation says to re-save it as an admin rather than blaming a role it never had");

  // The ADMIN-saved review rule is unchanged: it starts, keeps its write and its reads.
  const before4 = pushed.length;
  await fire("LZPT-115", cfg({ mode: "review" }));
  const p = pushed.slice(before4)[0].body.params;
  ok(p.savedByRole === "admin" && p.allowedActions.includes("add_pr_comment"),
    "an ADMIN-saved review rule still starts and keeps the PR comment write");
  ok(p.allowedActions.includes("get_pull_request"), "…and its reads");
}

/* ══════════ the mode subset actually narrows ══════════ */
{
  const before = pushed.length;
  await fire("LZPT-103", cfg({ mode: "open-branch" }));
  const p = pushed.slice(before)[0].body.params;
  ok(!p.allowedActions.includes("commit_files") && !p.allowedActions.includes("open_pull_request"),
    "open-branch may not commit or open a PR");
  ok(p.allowedActions.includes("create_branch"), "…it may create the branch");
}

/* ══════════ 6. the dry-run flag ══════════ */
{
  const before = pushed.length;
  await fire("LZPT-104", cfg({ simulationMode: true }));
  const p = pushed.slice(before)[0].body.params;
  ok(p.simulation === true, "a rule in Simulation Mode queues the turn as simulated");
  const l = await lastLog("LZPT-104");
  ok(l && /simulation/i.test(l.reason), "…and the log says so, so nobody thinks it wrote");
}

/* ══════════ a dead token, and a repo off the allow-list ══════════ */
{
  await storage.set(`git_conn:${CONN}`, { id: CONN, kind: "github", label: "Acme GitHub", status: "auth_dead", repos: [REPO] });
  const before = pushed.length;
  await fire("LZPT-107", cfg({ strict: true }));
  ok(pushed.length === before, "a dead token enqueues nothing");
  const l = await lastLog("LZPT-107");
  ok(l && l.isValid === false && /sign in/i.test(l.reason), "…and says the connection cannot sign in");
  await storage.set(`git_conn:${CONN}`, { id: CONN, kind: "github", label: "Acme GitHub", status: "ok", repos: ["other/repo"] });
  await fire("LZPT-108", cfg({ strict: false }));
  ok(pushed.length === before, "a repo off the allow-list enqueues nothing");
  const l2 = await lastLog("LZPT-108");
  ok(l2 && l2.isValid === true && /allow-list/i.test(l2.reason), "…and fails OPEN with the reason when strict is off");
  await storage.set(`git_conn:${CONN}`, { id: CONN, kind: "github", label: "Acme GitHub", status: "ok", repos: [REPO] });
}

/* ══════════ a misconfigured rule is CLOSED in both columns ══════════ */
{
  const before = pushed.length;
  await fire("LZPT-109", cfg({ mode: "teleport", strict: false }));
  ok(pushed.length === before, "an unknown mode enqueues nothing");
  const l = await lastLog("LZPT-109");
  ok(l && l.isValid === false, "…and is an ERROR even with strict OFF — a wrong rule is not an environment problem");
  await fire("LZPT-110", cfg({ ruleId: "rule-coder-ownerless", strict: false }));
  const l2 = await lastLog("LZPT-110");
  ok(l2 && l2.isValid === false && /owner/i.test(l2.reason), "a rule with no owner account is an ERROR");
}

/* ══════════ F-392 — ONE TEST PER ROW OF THE FAIL-OPEN/FAIL-CLOSED TABLE ══════════ */
// The table beside enqueueCoderPostFunction is the contract; ORDER is part of it. An
// ownerless rule used to reach the GATE first, empty its allow-list and return a green
// SKIP, so the "no owner ⇒ ERROR in both columns" row was unreachable.
{
  const verdict = async (issueKey, over) => { await fire(issueKey, cfg(over)); return lastLog(issueKey); };
  const isError = (l) => !!l && l.isValid === false && l.stepResults[0].status === "error";
  const isSkip = (l) => !!l && l.isValid === true && l.stepResults[0].status === "skipped";

  // ROW: connection missing — SKIP when strict is off, ERROR when on.
  ok(isSkip(await verdict("LZPT-120", { connectionId: "gone", strict: false })), "connection missing, strict OFF ⇒ SKIP");
  ok(isError(await verdict("LZPT-121", { connectionId: "gone", strict: true })), "connection missing, strict ON ⇒ ERROR");
  // ROW: repository off the allow-list — the same two columns.
  ok(isSkip(await verdict("LZPT-122", { repo: "other/repo", strict: false })), "repo off the allow-list, strict OFF ⇒ SKIP");
  ok(isError(await verdict("LZPT-123", { repo: "other/repo", strict: true })), "repo off the allow-list, strict ON ⇒ ERROR");
  // ROW: mode unknown — ERROR in BOTH columns.
  ok(isError(await verdict("LZPT-124", { mode: "teleport", strict: false })), "unknown mode, strict OFF ⇒ ERROR");
  ok(isError(await verdict("LZPT-125", { mode: "teleport", strict: true })), "unknown mode, strict ON ⇒ ERROR");
  // ROW: no owner account — ERROR in BOTH columns…
  ok(isError(await verdict("LZPT-126", { ruleId: "rule-coder-ownerless", strict: false })), "no owner, strict OFF ⇒ ERROR");
  ok(isError(await verdict("LZPT-127", { ruleId: "rule-coder-ownerless", strict: true })), "no owner, strict ON ⇒ ERROR");
  // …INCLUDING when an environment row would also have fired. This is F-392 itself: the
  // config check is answered FIRST, so the promised red row cannot be masked by a SKIP.
  const both = await verdict("LZPT-128", { ruleId: "rule-coder-ownerless", connectionId: "", repo: "", strict: false });
  ok(isError(both) && /owner/i.test(both.reason),
    "an ownerless rule that ALSO has no connection is the OWNER error, not a green skip (F-392)");
  // ROW: the queue push failed — ERROR in both columns, and nothing ran inline.
  const { Queue } = await import("@forge/events");
  const realPush = Queue.prototype.push;
  Queue.prototype.push = async () => { throw new Error("queue unavailable"); };
  let pushFail;
  try { pushFail = await verdict("LZPT-129", { strict: false }); } finally { Queue.prototype.push = realPush; }
  ok(isError(pushFail), "a failed queue push is an ERROR even with strict OFF — nothing was started");
}

/* ══════════ F-394 — the role is STAMPED at save time and read ONLY from the row ══════════ */
{
  // (a) the SOURCE property: `savedByRoleFor` authorizes the CALLER (getUserPermissions
  //     arm 2 asks Jira `mypermissions` as the invoking user), so it may only ever be
  //     asked about the caller. A call carrying a third party's id is the F-394 defect.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath: toPath } = await import("node:url");
  const pathMod = await import("node:path");
  const indexRaw = readFileSync(pathMod.join(pathMod.dirname(toPath(import.meta.url)), "../../src/index.js"), "utf8");
  // CODE ONLY — the comments beside the fix quote the defect they removed.
  const indexSrc = indexRaw.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const allCalls = [...indexSrc.matchAll(/await savedByRoleFor\(([^)]*)\)/g)].map((m) => m[1].trim());
  ok(allCalls.length > 0, "savedByRoleFor is still called somewhere");
  ok(allCalls.every((a) => a === "context.accountId" || a === "accountId"),
    `every savedByRoleFor call asks about the CALLER (saw ${JSON.stringify([...new Set(allCalls)])})`);
  ok(/const stampSavedByRole = async \(accountId\) =>/.test(indexSrc),
    "the save-time stamp has ONE home (stampSavedByRole)");
  ok(!/savedByRoleFor\(ownerAccountId\)/.test(indexSrc),
    "nothing re-reads a rule OWNER's role at run time");

  // (b) the behaviour: registerPostFunction stamps the SAVER's role on the row.
  await storage.set("app_admins", [
    { accountId: ADMIN, role: "admin", scope: "all" },
    { accountId: EDITOR, role: "editor", scope: "all" },
  ]);
  const { handler } = await import("../../src/index.js");
  const call = (functionKey, payload, accountId) =>
    handler({ call: { functionKey, payload } }, { principal: { accountId } });
  const base = { type: "postfunction-coder", workflow: { workflowName: "SW2", transitionId: "21" } };
  ok((await call("registerPostFunction", { id: "pf-a", ...base }, ADMIN)).success === true, "an admin may save a PF");
  let rows = await storage.get("config_registry");
  ok((rows.find((r) => r.id === "pf-a") || {}).savedByRole === "admin",
    "the row carries savedByRole 'admin' when an admin saved it");
  ok((await call("registerPostFunction", { id: "pf-b", ...base }, EDITOR)).success === true, "an editor may save a PF");
  rows = await storage.get("config_registry");
  ok((rows.find((r) => r.id === "pf-b") || {}).savedByRole === "editor",
    "…and 'editor' when an editor saved it");
  // Re-saved by an editor ⇒ DOWNGRADED. The row records who last armed it.
  await call("registerPostFunction", { id: "pf-a", ...base }, EDITOR);
  rows = await storage.get("config_registry");
  ok((rows.find((r) => r.id === "pf-a") || {}).savedByRole === "editor",
    "an editor re-saving an admin's rule DOWNGRADES the stamp — it is never sticky");
}

/* ══════════ F-398 — a PREMADE post-function can be registered at all ══════════ */
// `registerPostFunction` had no premade path: `ruleKind`/`premadeRuleType` were not even
// read, so a Coder rule saved from the rule editor landed as a semantic AI row. The
// catalogue is the authority for what may be saved and what each key may hold.
{
  await storage.set("app_admins", [
    { accountId: ADMIN, role: "admin", scope: "all" },
    { accountId: EDITOR, role: "editor", scope: "all" },
  ]);
  const { handler } = await import("../../src/index.js");
  const call = (functionKey, payload, accountId) =>
    handler({ call: { functionKey, payload } }, { principal: { accountId } });
  const rowById = async (id) => ((await storage.get("config_registry")) || []).find((r) => r.id === id) || null;

  const premadePayload = (over = {}) => ({
    id: "pf-premade-admin", type: "postfunction-coder",
    ruleKind: "premade", premadeRuleType: "postfunction-coder",
    mode: "build", instructions: "Use the existing lint config. \u{1F600}".padEnd(60, "x"),
    connectionId: CONN, repo: REPO, strict: true,
    prMatch: "branch",           // the Coder's git group switches prMatch OFF
    simulationMode: false,
    workflow: { workflowName: "SW3", transitionId: "31", transitionFromName: "To Do", transitionToName: "In Progress" },
    ...over,
  });

  ok((await call("registerPostFunction", premadePayload(), ADMIN)).success === true,
    "an admin can register the premade Coder post-function");
  const saved = await rowById("pf-premade-admin");
  ok(saved && saved.type === "postfunction-coder" && saved.ruleKind === "premade"
    && saved.premadeRuleType === "postfunction-coder",
    `the row is typed as the CATALOGUE key, not a semantic PF (got ${saved && saved.type}/${saved && saved.ruleKind})`);
  ok(saved && saved.mode === "build" && saved.connectionId === CONN && saved.repo === REPO && saved.strict === true,
    "…and carries the catalogue's declared params");
  ok(saved && !("prMatch" in saved),
    "…and NOT a sub-control this rule does not have (params.git.prMatch === false)");

  // F-463 — the catalogue declares `skillIds`, and the SERVER clamps it after the
  // lookup (shape, count, duplicates) through the same normalizer a listener's agent
  // block uses. The client is not trusted with the count.
  const withSkills = await call("registerPostFunction", premadePayload({
    id: "pf-premade-skills",
    skillIds: ["s_one", "s_two", "s_one", "not an id!", "s_three", "s_four", "s_five"],
  }), ADMIN);
  ok(withSkills.success === true, "a premade Coder rule may bind skills");
  const savedSkills = (await rowById("pf-premade-skills")) || {};
  ok(Array.isArray(savedSkills.skillIds) && savedSkills.skillIds.length === 4,
    `…and the stored binding is clamped to four (${JSON.stringify(savedSkills.skillIds)})`);
  ok(savedSkills.skillIds.join(",") === "s_one,s_two,s_three,s_four",
    "…de-duplicated, in the author's order, with the malformed id dropped");
  ok(saved && saved.savedByRole === "admin", "…stamped with the saver's role (F-394)");

  // The client is not trusted with the catalogue.
  const bogus = await call("registerPostFunction", premadePayload({ id: "pf-bogus", premadeRuleType: "postfunction-teleport" }), ADMIN);
  ok(bogus.success === false && /not an available premade post-function/.test(bogus.error || ""),
    `an unknown premadeRuleType is REFUSED with the one shape (got ${JSON.stringify(bogus)})`);
  ok((await rowById("pf-bogus")) === null, "…and nothing was written");
  await call("registerPostFunction", premadePayload({ id: "pf-badmode", mode: "teleport" }), ADMIN);
  const badMode = await rowById("pf-badmode");
  ok(badMode && !("mode" in badMode),
    "an unknown mode is DROPPED, never defaulted — the runtime's 'no valid mode' ERROR is the answer");
  await call("registerPostFunction", premadePayload({ id: "pf-longnote", instructions: "a".repeat(9000) + "\u{1F600}" }), ADMIN);
  const longNote = await rowById("pf-longnote");
  ok(longNote && [...longNote.instructions].length === CODER_PF_INSTRUCTIONS_MAX,
    `the note is clamped server-side to the catalogue cap in CODE POINTS (got ${longNote && [...longNote.instructions].length})`);

  // An editor-saved row: the stamp is what the transition reads, and F-390 refuses it.
  ok((await call("registerPostFunction", premadePayload({ id: "pf-premade-editor" }), EDITOR)).success === true,
    "an editor may register one too");
  ok((await rowById("pf-premade-editor")).savedByRole === "editor", "…and the row records that");

  // END TO END: the registered row drives a real transition.
  const before = pushed.length;
  await fire("LZPT-140", cfg({ ruleId: "pf-premade-admin", mode: "build" }));
  const ev = pushed.slice(before)[0];
  ok(ev && ev.body.taskType === "coder", "a transition on the registered ADMIN row enqueues a coder turn");
  ok(ev && ev.body.params.savedByRole === "admin" && ev.body.params.allowedActions.includes("commit_files"),
    "…armed by the ROW's stamp, so its write actions survive");
  const before2 = pushed.length;
  await fire("LZPT-141", cfg({ ruleId: "pf-premade-editor", mode: "build" }));
  ok(pushed.length === before2, "a transition on the registered EDITOR row enqueues nothing (F-390)");
}

/* ══════════ F-401 — PRIVILEGE IS READ FROM THE RULE'S OWN ROW, NEVER FROM A SIBLING ══════════ */
// The disable check has a workflow+transition FALLBACK tier (any non-instanced
// post-function row on the transition may MUTE this invocation). F-394 reused that same
// resolved row as the authority for `createdBy`/`savedByRole` — so a Coder rule whose id
// tier missed inherited a sibling SEMANTIC rule's admin stamp and got its git writes
// armed. Two PF rows on ONE transition; the coder config's id matches neither.
{
  await storage.set("app_admins", [
    { accountId: ADMIN, role: "admin", scope: "all" },
    { accountId: EDITOR, role: "editor", scope: "all" },
  ]);
  const { handler } = await import("../../src/index.js");
  const call = (functionKey, payload, accountId) =>
    handler({ call: { functionKey, payload } }, { principal: { accountId } });
  const WF = { workflowName: "SW9", transitionId: "91", transitionFromName: "To Do", transitionToName: "In Progress" };

  // (1) the sibling: an ADMIN-saved SEMANTIC post-function, non-instanced — exactly the
  //     row the fallback tier would hand over.
  ok((await call("registerPostFunction", {
    id: "pf-sem-sibling", type: "postfunction-semantic", fieldId: "description",
    actionFieldId: "summary", actionPrompt: "summarise", workflow: WF,
  }, ADMIN)).success === true, "the admin's semantic sibling is registered on the transition");
  // (2) the Coder rule itself, saved by an EDITOR.
  ok((await call("registerPostFunction", {
    id: "pf-coder-own", type: "postfunction-coder", ruleKind: "premade",
    premadeRuleType: "postfunction-coder", mode: "build",
    connectionId: CONN, repo: REPO, workflow: WF,
  }, EDITOR)).success === true, "the coder rule is registered by an editor on the SAME transition");
  const rows = (await storage.get("config_registry")) || [];
  const sib = rows.find((r) => r.id === "pf-sem-sibling");
  ok(sib && sib.savedByRole === "admin" && sib.instanced !== true,
    "…and the sibling really is a non-instanced admin-stamped PF row (the fallback's shape)");

  // (a) THE DEFECT: the coder config's id resolves to NO row (renamed/legacy id). The
  //     fallback tier would find the semantic sibling; privilege must not.
  const before = pushed.length;
  await fire("LZPT-150", cfg({ ruleId: "pf-coder-drifted", mode: "build", strict: false,
    workflow: WF }));
  ok(pushed.length === before,
    "a coder rule whose id matches no row enqueues NOTHING — it may not borrow the sibling's owner");
  const l = await lastLog("LZPT-150");
  ok(l && l.isValid === false && l.stepResults[0].status === "error" && /owner/i.test(l.reason),
    `…it is OWNERLESS: an ERROR row in both strict columns (got ${l && l.stepResults[0].status})`);
  ok(l && /save it once/i.test(l.recommendation || ""),
    "…and the log tells the admin to re-save the rule");

  // (b) THE EXACT ROW still decides: its own editor stamp refuses the writes (F-390)…
  const before2 = pushed.length;
  await fire("LZPT-151", cfg({ ruleId: "pf-coder-own", mode: "build", strict: false, workflow: WF }));
  ok(pushed.length === before2,
    "the exact row's OWN editor stamp still refuses the build writes — not the sibling's admin stamp");
  const l2 = await lastLog("LZPT-151");
  ok(l2 && /Commit files/.test(l2.reason || ""),
    "…naming the refused write, so the sibling's admin role provably did not arm it");

  // …and an ADMIN-saved coder row on the same transition IS armed, by exact id match.
  ok((await call("registerPostFunction", {
    id: "pf-coder-own", type: "postfunction-coder", ruleKind: "premade",
    premadeRuleType: "postfunction-coder", mode: "build",
    connectionId: CONN, repo: REPO, workflow: WF,
  }, ADMIN)).success === true, "an admin re-saves the coder rule");
  const before3 = pushed.length;
  await fire("LZPT-152", cfg({ ruleId: "pf-coder-own", mode: "build", strict: false, workflow: WF }));
  const ev = pushed.slice(before3)[0];
  ok(ev && ev.body.taskType === "coder", "an EXACT id match arms the turn");
  ok(ev && ev.body.params.savedByRole === "admin" && ev.body.params.allowedActions.includes("commit_files"),
    "…with its OWN row's stamp, writes included");
  // F-409 — THE ARMING SAVE MOVES BOTH FIELDS. The admin re-save above did not merely
  // raise the role: it took over as the account the turn runs as. Arming a rule for
  // repository writes while it commits as someone else is the state nobody can reason
  // about — one save, one authority. (The sibling's admin is still never consulted.)
  ok(ev && ev.body.params.accountId === ADMIN,
    "…and it runs as the ADMIN who armed it — createdBy moved with savedByRole, never the sibling's");
  const own = ((await storage.get("config_registry")) || []).find((r) => r.id === "pf-coder-own");
  ok(own && own.createdBy === ADMIN && own.savedByRole === "admin",
    "…the row records the arming account and role together");
  ok(own && own.firstCreatedBy === EDITOR,
    "…and firstCreatedBy still names the editor who first authored it (display only, never a permission)");

  // The disable check KEEPS the fallback: disabling the sibling still mutes the
  // transition's post-function invocation, which is what that tier exists for.
  const all = (await storage.get("config_registry")) || [];
  await call("disablePostFunction", { id: "pf-sem-sibling" }, ADMIN).catch(() => {});
  const after = (await storage.get("config_registry")) || [];
  ok(all.length === after.length, "the sibling row is still there after the disable call");
}

console.log(`\npremade-coder-pf: ${pass} passed, ${fail} failed`);

/* ══════════ 5. the HEADLESS halt, against the real engine ══════════ */
// A separate child process: the engine suite has to stub src/index.js at the loader,
// which cannot coexist with importing the real one above.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const runChild = (label, argv, env) => {
  const c = spawnSync(process.execPath, argv, { encoding: "utf8", env: { ...process.env, ...env } });
  process.stdout.write((c.stdout || "").split("\n").filter((l) => /passed|FAIL/.test(l)).join("\n") + "\n");
  if (c.status !== 0) { process.stderr.write(c.stderr || ""); fail++; console.log(`FAIL: the ${label} suite failed`); }
};
runChild("headless engine", [
  "--import", path.join(here, "../lib/register-mocks.mjs"),
  path.join(here, "premade-coder-pf.headless.mjs"),
]);
// 4. capability OFF — a re-exec of THIS file, because the provider memo cannot be flipped
// in-process (see CAP_OFF above).
runChild("capability off", [
  "--import", path.join(here, "../lib/register-mocks-index.mjs"),
  path.join(here, "premade-coder-pf.test.mjs"),
], { CODER_PF_CAP_OFF: "1" });

console.log(`\nTOTAL premade-coder-pf: ${fail === 0 ? "PASS" : "FAIL"} (${pass} assertions passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);
