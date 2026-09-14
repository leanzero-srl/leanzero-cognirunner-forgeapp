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
 * emitted only when `blockText(knowledge.skillsBlock)` is non-empty. It is read from the
 * TURN'S EXECUTION LOG (`getAsyncTaskResult().result.logs`), NOT from `forge logs`: the
 * Coder's `log` sink is an in-memory array, not the console (see the note at the arm
 * itself). A control turn with NO skillIds must not produce that line; without the
 * control, the line proves nothing.
 *
 * THE AGENT MODEL IS RESTORED. The slot starts ABSENT on the default tenant (Haiku is
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
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
/* F-782 — the flip decision and the precondition verdict have ONE home, and it is not here. */
import { decideInstanceFlip, judgeAgentCapability } from "../lib/agent-capability-precondition.mjs";

const { envName: ENV_NAME, hookUrl: URL_ } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["providerSlot", "kvs"], defaultEnv: "staging" });
const env = loadEnv();
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
/* F-782 — a row that is neither proven nor broken. A missing provider-slot precondition is
   UNPROVEN: it must not count as a failure, and it must still be on the evidence file. */
const nv = (label, data = {}) => {
  evidence.checks.push({ label, ok: null, verdict: "N/V", ...data });
  console.log(`N/V   ${label}${Object.keys(data).length ? " " + JSON.stringify(data) : ""}`);
};
/* Did THIS run point the agent model slot anywhere? Only a run that did may restore it. */
let flipped = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/*
 * TRANSPORT RETRY, AND WHY IT IS NOT OPTIONAL HERE.
 *
 * This script had a bare `fetch`. One transient `fetch failed` mid-run therefore threw
 * straight past the turn AND out of the restore in the finally, which uses the same
 * helper - and staging was left on `claude-sonnet-5`, a FRONTIER model, on a live
 * tenant, with the script reporting "RESTORE FAILED" and exiting. Observed on
 * 2026-09-13. Every other live driver in this harness already wraps fetch; this one
 * changes instance-wide CONFIG, so it needed it most and had it least.
 *
 * The restore below additionally retries on its OWN, independently of this: a run that
 * cannot put the model back must say so after trying hard, never after trying once.
 */
const fetchRetry = async (url, init, tries = 5) => {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; console.log(`        (transport retry ${i + 1}/${tries}: ${e.message})`); await sleep(2000 * (i + 1)); }
  }
  throw last;
};
const post = async (body) => {
  const res = await fetchRetry(URL_, { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  /* F-741 — the three sentences below named STAGING while `--env` could move the run. */
  check(`${ENV_NAME} starts on the Coder edition with a NON-frontier agent model`,
    before.edition === "advanced" && before.enabled === false && before.reason === "needs-frontier-model",
    { edition: before.edition, reason: before.reason, agentModel: before.agentModel });
  const slotBefore = (await (await fetch(`${URL_}?what=kvs&key=${SLOT}`, { headers: { Authorization: `Bearer ${SECRET}` } })).json()).value;
  check("the agent-model slot is ABSENT before the switch, so deleting it restores exactly", slotBefore === null, { slotBefore });

  const skills = (await call("getSkills")).skills || [];
  const skill = skills.find((s) => s.builtin) || skills[0];
  check("a builtin skill exists to bind to the turn", !!skill, { id: skill && skill.id, name: skill && skill.name });

  // ── the documented staging agent-model switch, decided by the lib (F-782) ──
  const flip = decideInstanceFlip({ cap: before, frontier: FRONTIER, envName: ENV_NAME });
  console.log(`      model flip: ${flip.flip ? "ON" : "OFF"} — ${flip.reason}`);
  if (flip.flip) {
    flipped = true;
    const sw = await call("saveAgentModel", { model: FRONTIER });
    check(`the agent model switched to ${FRONTIER}`, sw.success === true && sw.model === FRONTIER, { model: sw.model, error: sw.error });
    console.log("waiting 40s for the ~30s provider/model cache…");
    await sleep(40000);
  }
  const cap = flip.flip ? await call("getAgentCapability") : before;
  /* F-767/F-782 — the capability is this script's PRECONDITION, not its subject: a slot that
     never came on leaves the skills-injection proof unproven, with the remedy named, and the
     sentence is the lib's. The SUBJECT assertions about `needs-frontier-model` (the starting
     state above, the restored state below) stay here, because those are what this file proves. */
  const capVerdict = judgeAgentCapability({ cap, flipped: flip.flip, envName: ENV_NAME, frontier: FRONTIER });
  if (capVerdict.verdict === "PASS") check(`the Coder is now ENABLED on ${ENV_NAME}`, true, { enabled: cap.enabled, agentModel: cap.agentModel });
  else { nv(capVerdict.what, { enabled: cap.enabled, reason: cap.reason, agentModel: cap.agentModel }); return; }

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
    /*
     * THE IN-FLIGHT STATUS IS "processing", and this loop used to break on "any status
     * that is not pending or running" - so it exited on the FIRST poll, every time, and
     * `check(!!res)` then PASSED on a turn that had not started. The thread was read
     * seconds later, empty, and the two assertions below failed for a reason that had
     * nothing to do with the app. A terminal status is now named EXPLICITLY: done or
     * error, and nothing else ends the wait.
     */
    const TERMINAL = new Set(["done", "error", "failed", "complete", "completed"]);
    let res = null;
    for (let i = 0; i < 72; i++) {
      const p = await call("getAsyncTaskResult", { taskId: r.taskId });
      if (p && p.status && TERMINAL.has(String(p.status))) { res = p; break; }
      await sleep(5000);
    }
    check(`${label}: getAsyncTaskResult reached a TERMINAL status (done/error), not merely "not pending"`,
      !!res && String(res.status) === "done", { status: res ? res.status : "(timed out)", error: res && res.error });
    const thread = await call("getCoderThread", { issueKey: ISSUE, threadId });
    return { threadId, taskId: r.taskId, result: res, thread: thread && thread.thread };
  };

  const withSkill = await runTurn("with-skill", [skill.id]);
  const control = await runTurn("control", []);
  evidence.withSkill = withSkill; evidence.control = control;
  check("with-skill: the thread records the turn and it ran in SIMULATION (the hook forces it)",
    !!(withSkill.thread && withSkill.thread.simulation === true),
    { simulation: withSkill.thread && withSkill.thread.simulation, turns: withSkill.thread && (withSkill.thread.turns || []).length });
  /* THE THREAD ROW'S SHAPE, read off a real row rather than assumed:
   *   { createdAt, issueKey, messages: [...], ownerAccountId, simulation, threadId,
   *     turns: <NUMBER>, updatedAt }
   * `turns` is a COUNT, not an array - calling .map on it threw "map is not a function"
   * and took the whole run down before the restore. The messages live in `messages`, and
   * the F-487 receipt rides on the `user` row as `knowledge`. */
  check("with-skill: the thread row exposes messages[] and a turns COUNT",
    Array.isArray(withSkill.thread && withSkill.thread.messages) && typeof (withSkill.thread || {}).turns === "number",
    { turns: withSkill.thread && withSkill.thread.turns, messages: withSkill.thread && (withSkill.thread.messages || []).length });
  /* ── F-487 — THE KNOWLEDGE RECEIPT, on the thread row the resolver hands back ──
   *
   * `summarizeKnowledge` stamps IDS AND COUNTS ONLY onto the turn's `user` row; the
   * block itself deliberately never enters the thread. So the receipt is the ONLY read
   * path that can show the bound skill reached the model, and the CONTROL turn is what
   * makes it evidence: the same field, same issue, same thread shape, skillCount 0.
   */
  const receiptOf = (t) => {
    // `messages`, never `turns` — see the shape note above.
    const msgs = (t && Array.isArray(t.messages) && t.messages) || [];
    const withK = msgs.filter((m) => m && m.knowledge);
    return withK.length ? withK[withK.length - 1].knowledge : null;
  };
  const kWith = receiptOf(withSkill.thread);
  const kCtl = receiptOf(control.thread);
  console.log(`\n  with-skill knowledge receipt: ${JSON.stringify(kWith)}`);
  console.log(`  control    knowledge receipt: ${JSON.stringify(kCtl)}`);
  check("with-skill: the turn carries an F-487 knowledge receipt", !!kWith, { receipt: kWith });
  check("with-skill: the receipt names the bound skill id",
    !!(kWith && Array.isArray(kWith.skillIds) && kWith.skillIds.includes(skill.id)),
    { skillIds: kWith && kWith.skillIds, expected: skill.id });
  check("with-skill: the receipt counts exactly one skill (skillCount === 1)",
    !!(kWith && kWith.skillCount === 1), { skillCount: kWith && kWith.skillCount });
  check("control: the SAME field reports no skills (skillCount 0, or no receipt at all) - so the count above is a real measurement",
    !kCtl || kCtl.skillCount === 0 || !(kCtl.skillIds || []).length,
    { receipt: kCtl });

  /* ── THE `Knowledge injected: …` LINE, and WHERE IT ACTUALLY LIVES ─────────
   *
   * CORRECTION TO THIS SCRIPT'S OWN HEADER, measured 2026-09-13: the line does NOT
   * reach `forge logs`. `logKnowledgeInjection(knowledge, log)` writes through the
   * `log` the CALLER supplies, and the Coder's is `const log = (s) => logs.push(...)`
   * (src/coder-engine.js) - an in-memory array that becomes the turn's EXECUTION LOG,
   * surfaced through `getAsyncTaskResult().result.logs`. Nothing on this path calls
   * `console.log`, so grepping forge logs for it will always come back empty and that
   * emptiness says nothing about the app. The evidence is the turn result, and the
   * control turn is what makes it evidence.
   */
  const turnLogs = (r) => ((r && r.result && r.result.result && r.result.result.logs) || []).map(String);
  const withLine = turnLogs(withSkill).some((l) => l.startsWith("Knowledge injected:") && l.includes("skills"));
  const ctlLine = turnLogs(control).some((l) => l.startsWith("Knowledge injected:"));
  console.log(`\n  with-skill logs[0]: ${JSON.stringify(turnLogs(withSkill)[0] || null).slice(0, 120)}`);
  console.log(`  control    logs[0]: ${JSON.stringify(turnLogs(control)[0] || null).slice(0, 120)}`);
  check('with-skill: the turn execution log carries `Knowledge injected: skills`', withLine, { line: turnLogs(withSkill).find((l) => l.startsWith("Knowledge injected:")) || null });
  check('control: the SAME log has NO `Knowledge injected:` line - the pair is what makes the line evidence', !ctlLine, { logs0: turnLogs(control)[0] || null });
  /* The task RESULT carries the summary too, on the with-skill turn only. */
  const resK = (r) => r && r.result && r.result.result && r.result.result.knowledge;
  check("with-skill: the task result carries the knowledge summary", !!resK(withSkill), { knowledge: resK(withSkill) });
  check("control: the task result carries NO knowledge summary", !resK(control), { knowledge: resK(control) });

  console.log("\nTask ids (the turn execution log, NOT forge logs, is where the line lives):");
  console.log(`  with-skill: ${withSkill.taskId}`);
  console.log(`  control   : ${control.taskId}`);
};

try { await main(); } catch (e) { console.error("THREW", e.stack); failures += 1; }
finally {
  /* RESTORE, on every path THIS RUN MUTATED. The slot was absent; absent is what it goes back
     to. F-782: a run that never flipped must not delete a slot somebody else set — deleting
     what you did not write is a mutation, not a cleanup. */
  try {
    if (!flipped) console.log("        no restore: this run did not point the agent model slot anywhere");
    else {
    /* THE RESTORE RETRIES ON ITS OWN. `post` already retries the transport; this loop
     * additionally retries a hook that ANSWERED but not with `now:null`. A frontier
     * model left armed on a live tenant is the worst outcome this script can have, so
     * it is the one step allowed to be stubborn. */
    let r = null;
    for (let i = 0; i < 4; i++) {
      r = await kvSet(SLOT, null).catch((e) => ({ status: 0, body: { error: e.message } }));
      if (r.status === 200 && r.body && r.body.now === null) break;
      console.log(`        (restore attempt ${i + 1}/4 did not confirm: ${JSON.stringify(r.body).slice(0, 160)})`);
      await sleep(3000 * (i + 1));
    }
    check("the agent-model slot was deleted (restored)", r.status === 200 && r.body && r.body.now === null, { now: r.body && r.body.now });
    await sleep(35000);
    const after = await call("getAgentCapability");
    check(`${ENV_NAME} is back to needs-frontier-model`, after.enabled === false && after.reason === "needs-frontier-model",
      { enabled: after.enabled, reason: after.reason, agentModel: after.agentModel });
    }
  } catch (e) { console.error("RESTORE FAILED", e.message); failures += 1; }
  fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(evidence, null, 2));
  console.log(`\n${failures} failure(s). Evidence: ${OUT}/evidence.json`);
  process.exit(failures ? 1 : 0);
}
