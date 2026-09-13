/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * LIVE proof of F-463 — the SKILLS a panel turn binds actually reach the Coder's model.
 *
 * WHY STAGING. The Coder needs the Coder edition AND a frontier agent model. Development
 * is Standard (`getAgentCapability` → `needs-coder-edition`); staging carries the Coder
 * licence with the DEFAULT agent model (Haiku), so it answers `needs-frontier-model` —
 * which is exactly the before/after pair this script needs, and the switch is one slot.
 *
 * WHY SIMULATION IS NOT A CHOICE HERE. `src/test-hook.js` OVERWRITES `simulation` with
 * true on every `startCoderTurn` it forwards (F-387): the hook may drive the Coder but it
 * may never drive it live, because a live turn writes to somebody's repository. The turn
 * below still spends real frontier tokens — that is a cost, not a write.
 *
 * WHAT "PROVEN" MEANS FOR AN INJECTED PROMPT BLOCK. There is no read path for the prompt,
 * so the evidence is `src/agent-runner.js`'s own line — `Knowledge injected: skills` —
 * emitted only when `blockText(knowledge.skillsBlock)` is non-empty, pulled from
 * `forge logs -e staging` for THIS turn's task id. A control turn with NO skillIds must
 * not produce that line; without the control, the line proves nothing.
 *
 * THE AGENT MODEL IS RESTORED. The slot starts ABSENT on staging (Haiku is the default),
 * so restoring means DELETING it, and the script re-reads `getAgentCapability` afterwards
 * to show `needs-frontier-model` is back. It restores on every exit path, including a throw.
 *
 * Env: test-harness/.env (HARNESS_SECRET, HARNESS_ADMIN_ACCOUNT_ID) +
 *      STAGING_TESTSTATE_URL (forge webtrigger create -f harness-test-state -e staging).
 *      The URL is a secret and is never printed.
 *
 *   STAGING_TESTSTATE_URL=<url> node scripts/coder-skills-live.mjs
 */
import fs from "node:fs";
import { loadEnv } from "../lib/env.mjs";

const env = loadEnv();
const URL_ = process.env.STAGING_TESTSTATE_URL || env.STAGING_TESTSTATE_URL || "";
const SECRET = env.HARNESS_SECRET;
const ACCT = process.env.HARNESS_ADMIN_ACCOUNT_ID || env.HARNESS_ADMIN_ACCOUNT_ID;
const ISSUE = process.env.CODER_ISSUE_KEY || "LZPT-186";
const FRONTIER = "claude-sonnet-5";
const SLOT = "COGNIRUNNER_AGENT_MODEL_atlassian";
const OUT = new URL("../results/coder-skills", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const evidence = { checks: [] };
const check = (label, ok, data = {}) => {
  if (!ok) failures += 1;
  evidence.checks.push({ label, ok, ...data });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${Object.keys(data).length ? " " + JSON.stringify(data) : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (body) => {
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const t = await res.text();
  let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = { raw: t.slice(0, 300) }; }
  return { status: res.status, body: b };
};
const call = async (functionKey, payload = {}) => {
  const r = await post({ action: "invokeResolver", functionKey, accountId: ACCT, payload });
  if (r.status !== 200) throw new Error(`${functionKey} HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};
const kvSet = (key, value) => post({ action: "kvSet", key, value });

const main = async () => {
  const before = await call("getAgentCapability");
  check("staging starts on the Coder edition with a NON-frontier agent model",
    before.edition === "advanced" && before.enabled === false && before.reason === "needs-frontier-model",
    { edition: before.edition, reason: before.reason, agentModel: before.agentModel });
  const slotBefore = (await (await fetch(`${URL_}?what=kvs&key=${SLOT}`, { headers: { Authorization: `Bearer ${SECRET}` } })).json()).value;
  check("the agent-model slot is ABSENT before the switch, so deleting it restores exactly", slotBefore === null, { slotBefore });

  const skills = (await call("getSkills")).skills || [];
  const skill = skills.find((s) => s.builtin) || skills[0];
  check("a builtin skill exists to bind to the turn", !!skill, { id: skill && skill.id, name: skill && skill.name });

  // ── the documented staging agent-model switch ──
  const sw = await call("saveAgentModel", { model: FRONTIER });
  check(`the agent model switched to ${FRONTIER}`, sw.success === true && sw.model === FRONTIER, { model: sw.model, error: sw.error });
  console.log("waiting 40s for the ~30s provider/model cache…");
  await sleep(40000);
  const cap = await call("getAgentCapability");
  check("the Coder is now ENABLED on staging", cap.enabled === true, { enabled: cap.enabled, reason: cap.reason, agentModel: cap.agentModel });

  // ── the unknown-skill refusal, asked FIRST so a real turn never hides it ──
  const bogus = await call("startCoderTurn", { issueKey: ISSUE, threadId: `t_bogus_${Date.now().toString(36)}`, message: "Summarise this issue in two sentences.", skillIds: ["skill_definitely_not_here"] });
  check('an unknown skill id is refused with reason "unknown-skill"', bogus.success === false && bogus.reason === "unknown-skill",
    { success: bogus.success, reason: bogus.reason, error: String(bogus.error || "").slice(0, 200) });
  // THE PROVEN NEGATIVE: the same call with the REAL id must get through, or the refusal
  // above proves only that startCoderTurn refuses everything.

  const runTurn = async (label, skillIds) => {
    const threadId = `t_${label}_${Date.now().toString(36)}`;
    const r = await call("startCoderTurn", { issueKey: ISSUE, threadId, message: "Summarise this issue in two sentences.", skillIds });
    check(`${label}: the turn was accepted and queued`, r.success === true && !!r.taskId, { taskId: r.taskId, threadId, error: r.error, reason: r.reason });
    if (!r.taskId) return { threadId, taskId: null, result: null };
    let res = null;
    for (let i = 0; i < 60; i++) {
      const p = await call("getAsyncTaskResult", { taskId: r.taskId });
      if (p && p.success && p.status && p.status !== "pending" && p.status !== "running") { res = p; break; }
      if (p && p.result) { res = p; break; }
      await sleep(5000);
    }
    check(`${label}: getAsyncTaskResult returned a finished turn`, !!res, { status: res && res.status, keys: res && Object.keys(res) });
    const thread = await call("getCoderThread", { issueKey: ISSUE, threadId });
    return { threadId, taskId: r.taskId, result: res, thread: thread && thread.thread };
  };

  const withSkill = await runTurn("with-skill", [skill.id]);
  const control = await runTurn("control", []);
  evidence.withSkill = withSkill; evidence.control = control;
  check("with-skill: the thread records the turn and it ran in SIMULATION (the hook forces it)",
    !!(withSkill.thread && withSkill.thread.simulation === true),
    { simulation: withSkill.thread && withSkill.thread.simulation, turns: withSkill.thread && (withSkill.thread.turns || []).length });
  check("with-skill: the thread's turn carries the bound skill id",
    JSON.stringify(withSkill.thread && withSkill.thread.skillIds || (withSkill.thread && (withSkill.thread.turns || []).map((t) => t.skillIds).flat()) || []).includes(skill.id),
    { recorded: withSkill.thread && (withSkill.thread.skillIds || (withSkill.thread.turns || []).map((t) => t.skillIds)) });
  console.log("\nTask ids for the forge-logs read:");
  console.log(`  with-skill: ${withSkill.taskId}`);
  console.log(`  control   : ${control.taskId}`);
  console.log("  Now run:  npx forge logs -e staging -n 400 | grep -E 'Knowledge injected|coder'");
};

try { await main(); } catch (e) { console.error("THREW", e.stack); failures += 1; }
finally {
  // RESTORE, on every path. The slot was absent; absent is what it goes back to.
  try {
    const r = await kvSet(SLOT, null);
    check("the agent-model slot was deleted (restored)", r.status === 200 && r.body && r.body.now === null, { now: r.body && r.body.now });
    await sleep(35000);
    const after = await call("getAgentCapability");
    check("staging is back to needs-frontier-model", after.enabled === false && after.reason === "needs-frontier-model",
      { enabled: after.enabled, reason: after.reason, agentModel: after.agentModel });
  } catch (e) { console.error("RESTORE FAILED", e.message); failures += 1; }
  fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(evidence, null, 2));
  console.log(`\n${failures} failure(s). Evidence: ${OUT}/evidence.json`);
  process.exit(failures ? 1 : 0);
}
