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
  createdBy: ADMIN,
  connectionId: CONN,
  repo: REPO,
  mode: "build",
  strict: false,
  workflow: { workflowName: "SW", transitionFromName: "To Do", transitionToName: "In Progress", transitionId: "11" },
  ...over,
});
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
  ok(p.accountId === ADMIN && p.savedByRole === "admin", "it runs as the rule's owner, whose role is re-read live");
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

/* ══════════ 3. an EDITOR-saved rule, end to end ══════════ */
{
  const before = pushed.length;
  await fire("LZPT-102", cfg({ createdBy: EDITOR, mode: "review" }));
  const p = pushed.slice(before)[0].body.params;
  ok(p.savedByRole === "editor", "a non-admin owner is 'editor'");
  ok(!p.allowedActions.includes("add_pr_comment"),
    "an editor-saved review rule cannot hold the PR comment write");
  ok(p.allowedActions.includes("get_pull_request"), "…but keeps the reads, so it still reports");
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
  await fire("LZPT-110", cfg({ createdBy: null, strict: false }));
  const l2 = await lastLog("LZPT-110");
  ok(l2 && l2.isValid === false && /owner/i.test(l2.reason), "a rule with no owner account is an ERROR");
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
