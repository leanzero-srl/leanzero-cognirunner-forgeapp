/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-302 — THE RESOLVER HALF OF THE AGENT ACTION GATE.
//
// `agent-actions-gate.test.mjs` proves the gate itself and asserts the two RUN sites
// by reading their source. This suite proves the other direction, through the REAL
// resolvers in src/index.js: that the instance's facts are actually READ and handed
// to the gate, so the git namespace is reachable at all.
//
// Before the wiring, no production call site supplied a context. Save time therefore
// gated against the restrictive default and refused every git action with
// "capability-off:git" — naming a capability that was never computed on that path,
// with no setting anywhere an admin could change to satisfy it.
//
// THE MEMO IS THE CONSTRAINT ON THIS SUITE. `getProviderConfig()` caches for 30 s with
// no reset seam, so ONE process can only prove ONE tenant. This one is the ENABLED
// tenant (BYOK + Coder), which is the harder claim — the refusal direction is proved
// on the default tenant by permission-refusal-shape.test.mjs, in its own process.
//
// Run: node scripts/agent-gate-resolvers.test.mjs (auto-discovered by run-offline.mjs)

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const EDITOR = "acct-editor";

// Seed BEFORE the first resolver call: the provider memo takes the first answer it
// reads and holds it for the life of this process.
await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });
await storage.set("app_admins", [
  { accountId: ADMIN, role: "admin", scope: "all" },
  { accountId: EDITOR, role: "editor", scope: "all" },
]);
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { handler } = await import("../../src/index.js");
const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

const agentListener = (over = {}) => ({
  name: "Git agent", events: ["avi:jira:created:issue"], mode: "agent",
  agent: { instructions: "review the PR", allowedActions: ["commit_files"] },
  ...over,
});

/* ===== 1. the git namespace is REACHABLE — the whole point of the finding ===== */
{
  const saved = await call("saveListener", { listener: agentListener() });
  ok(saved && saved.success === true,
    `a BYOK + Coder tenant can SAVE a listener holding a git write (got ${JSON.stringify(saved).slice(0, 220)})`);
  ok(saved.success && Array.isArray(saved.listener.agent.allowedActions)
    && saved.listener.agent.allowedActions.includes("commit_files"),
    "…and the action survives normalisation instead of being silently dropped");
}
{
  const job = await call("saveScheduledJob", {
    job: {
      name: "Git job", schedule: { cron: "0 9 * * *", timeZone: "UTC" }, mode: "agent",
      agent: { instructions: "do it", allowedActions: ["commit_files"] },
    },
  });
  ok(job && job.success === true, `a scheduled JOB is gated by the same facts (got ${JSON.stringify(job).slice(0, 200)})`);
  ok(job.success && job.job.agent.allowedActions.includes("commit_files"), "…and keeps the git write too");
}

/* ===== 2. savedByRole is the SAVER's role, never a caller-supplied claim ===== */
{
  const byAdmin = await call("saveListener", { listener: agentListener({ name: "By admin" }) }, ADMIN);
  ok(byAdmin.success && byAdmin.listener.savedByRole === "admin", "an admin's save records savedByRole:'admin'");

  // Every git WRITE is a confirm action, so an editor's save of one is refused — and
  // that refusal is itself the proof that savedByRole came from the ROSTER: nothing in
  // the payload differed between these two calls.
  const editorWrite = await call("saveListener", { listener: agentListener({ name: "By editor" }) }, EDITOR);
  ok(editorWrite.success === false && Array.isArray(editorWrite.refused) && editorWrite.refused[0].reason === "needs-admin",
    `an editor cannot save a git WRITE — identical payload, different saver (got ${JSON.stringify(editorWrite).slice(0, 200)})`);
  // A git READ has no confirm flag, so an editor holds it and the row records the role.
  const editorRead = await call("saveListener", {
    listener: agentListener({ name: "By editor read", agent: { instructions: "x", allowedActions: ["get_pull_request"] } }),
  }, EDITOR);
  ok(editorRead.success === true && editorRead.listener.savedByRole === "editor",
    `an editor's save of a git READ succeeds and records savedByRole:'editor' (got ${JSON.stringify(editorRead).slice(0, 200)})`);
  ok(editorRead.success && editorRead.listener.agent.allowedActions.includes("get_pull_request"),
    "…and the read action survives, so the capability itself is on");

  // An ADMIN-CONFIRM action is the one that actually needs the admin, and it must
  // come from the ROSTER, not from the payload — otherwise the flag is self-granted.
  const claimed = await call("saveListener", {
    listener: agentListener({
      name: "Self-granted", savedByRole: "admin",
      agent: { instructions: "x", allowedActions: ["add_pr_comment"] },
    }),
  }, EDITOR);
  ok(claimed.success === false && claimed.reason === "action-not-allowed",
    `an editor cannot mint an admin-only action by putting savedByRole:"admin" in the payload (got ${JSON.stringify(claimed).slice(0, 200)})`);
  ok(Array.isArray(claimed.refused) && claimed.refused[0].reason === "needs-admin",
    "…and the refusal names the real cause");

  const byRealAdmin = await call("saveListener", {
    listener: agentListener({ name: "Real admin", agent: { instructions: "x", allowedActions: ["add_pr_comment"] } }),
  }, ADMIN);
  ok(byRealAdmin.success === true, "…while a real admin holds it");
}

/* ===== 3. a TEST gates exactly like a SAVE ===== */
{
  const tested = await call("testListener", { listener: agentListener({ name: "Draft" }), eventType: "avi:jira:created:issue" });
  ok(tested && tested.success !== undefined, "testListener answers");
  ok(!(tested.success === false && tested.reason === "action-not-allowed"),
    `a draft an admin could SAVE is not refused at TEST time (got ${JSON.stringify(tested).slice(0, 200)})`);
  // The inverse matters more: a draft that would be REFUSED at save must not pass a
  // test, or the admin proves something the save then rejects.
  const badDraft = await call("testListener", {
    listener: agentListener({ name: "Bad draft", agent: { instructions: "x", allowedActions: ["add_pr_comment"] } }),
    eventType: "avi:jira:created:issue",
  }, EDITOR);
  ok(badDraft.success === false && badDraft.reason === "action-not-allowed",
    `an editor's draft holding an admin-only action is refused at TEST time too (got ${JSON.stringify(badDraft).slice(0, 200)})`);
}

/* ===== 4. one memo read, and no fact is invented ===== */
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../src/index.js", import.meta.url), "utf8");
  ok(/const agentGateFacts = async \(context\)/.test(src),
    "the facts are read in ONE helper — no resolver assembles its own");
  ok(!/capability:\s*\{\s*git:/.test(src),
    "index.js never hand-builds the gate CONTEXT shape; buildAgentGateContext owns it");
  const helper = src.slice(src.indexOf("const agentGateFacts"), src.indexOf("const savedByRoleFor"));
  ok((helper.match(/getProviderConfig\(\)/g) || []).length === 1,
    "provider AND allowance come from ONE memo read, not two");
  ok(/catch \(e\) \{ \/\* restrictive/.test(helper),
    "a fact that cannot be read is OMITTED — the gate then refuses rather than assuming");
}

console.log(`agent-gate resolvers (F-302): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
