/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-610 — A RESUMED CODER TURN RUNS WITH THE SKILLS THE THREAD WAS STARTED WITH.
 *
 * THE DEFECT. `rememberCoderTurnParams` has carried a `skillIdsExplicit` arm since F-594,
 * but nothing in the product produced the flag: `startCoderTurn` never read the stored row
 * at all, so turn 2 from a second browser (the picker lives in the viewer's localStorage
 * and posts no `skillIds`) rebuilt the pin from the default set and the thread's skills
 * vanished mid-conversation, silently. cc3b4ec cut the producer.
 *
 * THE SHAPE OF THE PROOF — four turns of ONE thread, each graded on TWO reads:
 *   turn 1  `skillIds:[A,B]`  → the stored `coder_turn:{issue}:{thread}` row holds [A,B]
 *                               and the turn's own execution log says skills were injected.
 *   turn 2  NO `skillIds` key → the row STILL holds [A,B] (inheritance), the turn still
 *                               injects skills, and `forge logs` carries the engine's own
 *                               "turn carried no skill selection, inheriting…" line.
 *   turn 3  `skillIds:[]`     → an EXPLICIT empty list UNBINDS: the row becomes [] and the
 *                               turn injects no skills.
 *   turn 4  NO `skillIds` key → and it STAYS empty, because an inherited [] is not a
 *                               reason to fall back to anything.
 *
 * TURN 2 IS THE ONE THAT MATTERS, and turns 1 and 3 are its controls: without turn 1 the
 * row could be holding [A,B] for any reason, and without turn 3 "the row always holds
 * [A,B]" would be indistinguishable from inheritance.
 *
 * WHAT "SKILLS REACHED THE MODEL" MEANS. There is no read path for a prompt, so the
 * evidence is `src/agent-runner.js`'s own `Knowledge injected: … skills …` line, emitted
 * only when the skills block is non-empty, read from the TURN'S EXECUTION LOG
 * (`getAsyncTaskResult().result.logs`) — the Coder's `log` sink is an in-memory array, not
 * the console. Turn 3/4's absence of that line is graded against turns 1/2's presence of
 * it on the same thread, so it is a measured absence.
 *
 * NOTHING IS WRITTEN TO A REPOSITORY. `src/test-hook.js` overwrites `simulation:true` on
 * every `startCoderTurn` it forwards (F-387). The turns spend managed tokens; a cost, not
 * a write. RESTORE: the provider slot is recorded (MASKED in the output) before the flip
 * to the managed engine and put back in a `finally`.
 *
 * Usage (from test-harness/):
 *   node scripts/coder-skill-inherit-live.mjs [--issue=LZPT-186]
 * Env: STAGING_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 * Nothing secret is printed: not the trigger URL, not the Bearer, not the slot's old value.
 */
import fs from "node:fs";
import { loadEnv } from "../lib/env.mjs";

const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const URL_ = process.env.STAGING_TESTSTATE_URL || env.STAGING_TESTSTATE_URL || "";
const SECRET = env.HARNESS_SECRET;
const ACCT = process.env.HARNESS_ADMIN_ACCOUNT_ID || env.HARNESS_ADMIN_ACCOUNT_ID;
const ISSUE = arg("issue", "LZPT-186");
const PROVIDER_SLOT = "COGNIRUNNER_AI_PROVIDER";
const STAMP = Date.now().toString(36);
const THREAD = `t_f610_${STAMP}`;
const OUT = new URL("../results/coder-skill-inherit", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

if (!URL_ || !SECRET || !ACCT) { console.error("need STAGING_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID"); process.exit(2); }

let failures = 0;
const evidence = { issue: ISSUE, thread: THREAD, stamp: STAMP, checks: [], measurements: {} };
const check = (label, ok, data = {}) => {
  if (!ok) failures += 1;
  evidence.checks.push({ label, ok, ...data });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${Object.keys(data).length ? " " + JSON.stringify(data) : ""}`);
};
const note = (label, data) => { evidence.measurements[label] = data; console.log(`NOTE  ${label} ${JSON.stringify(data)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const kvGet = async (key) => {
  const res = await fetchRetry(`${URL_}?what=kvs&key=${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${SECRET}` } });
  const b = await res.json();
  return b && b.value !== undefined ? b.value : null;
};
const kvSet = (key, value) => post({ action: "kvSet", key, value });
const mask = (v) => (v === null || v === undefined ? String(v) : `${String(v).slice(0, 2)}***(len ${String(v).length})`);

// Built the way src/index.js builds it (safeKeyPart is the identity on [A-Za-z0-9_-]).
const turnKey = (issueKey, threadId) => `coder_turn:${issueKey}:${threadId}`;
const pinKey = (issueKey, threadId) => `coder_pin:${issueKey}:${threadId}`;

const runTurn = async (label, message, payloadExtra) => {
  const r = await call("startCoderTurn", { issueKey: ISSUE, threadId: THREAD, message, ...payloadExtra });
  if (r.success !== true || !r.taskId) {
    check(`${label}: the turn was accepted and queued`, false, { success: r.success, reason: r.reason, error: String(r.error || "").slice(0, 240) });
    return null;
  }
  const TERMINAL = new Set(["done", "error", "failed", "complete", "completed"]);
  let res = null;
  for (let i = 0; i < 72; i++) {
    const p = await call("getAsyncTaskResult", { taskId: r.taskId });
    if (p && p.status && TERMINAL.has(String(p.status))) { res = p; break; }
    await sleep(5000);
  }
  check(`${label}: the turn reached a TERMINAL status "done"`, !!res && String(res.status) === "done",
    { status: res ? res.status : "(timed out)", error: res && String(res.error || "").slice(0, 200) });
  const inner = (res && res.result) || null;
  const logs = ((inner && inner.logs) || []).map(String);
  const injected = logs.find((l) => /Knowledge injected/i.test(l)) || null;
  note(`${label}: knowledge line`, { line: injected });
  return { label, taskId: r.taskId, logs, injected, knowledge: inner && inner.knowledge };
};
const skillsInjected = (t) => !!(t && t.injected && /skills/i.test(t.injected));

const main = async () => {
  const providerBefore = await kvGet(PROVIDER_SLOT);
  console.log(`recorded ${PROVIDER_SLOT} before the flip: ${mask(providerBefore)}`);
  evidence.providerBeforeMasked = mask(providerBefore);
  try {
    const set = await kvSet(PROVIDER_SLOT, "managed");
    check("the provider slot was switched to the managed engine", set.status === 200 && set.body && set.body.now === "managed", { now: set.body && set.body.now });
    console.log("waiting 40s for the ~30s provider cache…");
    await sleep(40000);
    const cap = await call("getAgentCapability");
    check('the Coder is ENABLED on the managed engine (reason "managed")', cap.enabled === true && cap.reason === "managed", { enabled: cap.enabled, reason: cap.reason, edition: cap.edition });
    if (cap.enabled !== true) throw new Error(`the Coder is not enabled (${cap.reason}) — the rest of this script would prove nothing`);

    // ── two REAL skill ids, read from the store (never invented) ──────────────
    const sk = await call("getSkills");
    const ids = ((sk && sk.skills) || []).filter((s) => s && s.id && s.enabled !== false).slice(0, 2).map((s) => s.id);
    check("two real, enabled skills were found in this instance's store", ids.length === 2, { ids, total: ((sk && sk.skills) || []).length });
    if (ids.length !== 2) return;
    evidence.skillIds = ids;

    // ── the row must not pre-exist: a fresh thread id, proven empty first ─────
    const pre = await kvGet(turnKey(ISSUE, THREAD));
    check("this thread has NO stored turn-params row before turn 1 (the baseline)", pre === null, { row: pre });

    // ── turn 1: an explicit binding ───────────────────────────────────────────
    console.log("\nTURN 1 — skillIds:[A,B]");
    const t1 = await runTurn("turn1", "In one sentence, what is this issue about?", { skillIds: ids });
    const r1 = await kvGet(turnKey(ISSUE, THREAD));
    evidence.rowAfterTurn1 = r1 && { skillIds: r1.skillIds, simulation: r1.simulation, updatedAt: r1.updatedAt };
    check("turn 1 stored the two skill ids on the thread's turn-params row",
      !!r1 && Array.isArray(r1.skillIds) && r1.skillIds.length === 2 && ids.every((i) => r1.skillIds.includes(i)),
      { stored: r1 && r1.skillIds });
    check("turn 1's execution log says SKILLS were injected (the positive control for turns 3-4)", skillsInjected(t1), { line: t1 && t1.injected });

    // ── turn 2: no skillIds key at all ────────────────────────────────────────
    console.log("\nTURN 2 — no skillIds key in the payload");
    const t2 = await runTurn("turn2", "Add one more sentence about the risk.", {});
    const r2 = await kvGet(turnKey(ISSUE, THREAD));
    evidence.rowAfterTurn2 = r2 && { skillIds: r2.skillIds, updatedAt: r2.updatedAt };
    check("THE DEFECT: turn 2 carried no selection and the thread STILL holds both skills",
      !!r2 && Array.isArray(r2.skillIds) && r2.skillIds.length === 2 && ids.every((i) => r2.skillIds.includes(i)),
      { stored: r2 && r2.skillIds });
    check("turn 2 still injected SKILLS into the prompt", skillsInjected(t2), { line: t2 && t2.injected });
    const pin2 = await kvGet(pinKey(ISSUE, THREAD));
    evidence.pinAfterTurn2 = pin2 && { skillIds: pin2.skillIds, memoryEpoch: pin2.memoryEpoch, skillEpoch: pin2.skillEpoch };
    check("the PIN the thread replays also holds the two skills", !!pin2 && Array.isArray(pin2.skillIds) && pin2.skillIds.length === 2, { pinSkillIds: pin2 && pin2.skillIds });

    // ── turn 3: an explicit empty list ────────────────────────────────────────
    console.log("\nTURN 3 — skillIds:[] (an explicit unbind)");
    const t3 = await runTurn("turn3", "Now answer in one word: ready?", { skillIds: [] });
    const r3 = await kvGet(turnKey(ISSUE, THREAD));
    evidence.rowAfterTurn3 = r3 && { skillIds: r3.skillIds, updatedAt: r3.updatedAt };
    check("an EXPLICIT empty list unbinds: the row now holds []", !!r3 && Array.isArray(r3.skillIds) && r3.skillIds.length === 0, { stored: r3 && r3.skillIds });
    check("turn 3 injected NO skills (graded against turns 1-2, which did)", !skillsInjected(t3), { line: t3 && t3.injected });

    // ── turn 4: absent again, and it stays empty ──────────────────────────────
    console.log("\nTURN 4 — no skillIds key again");
    const t4 = await runTurn("turn4", "One more word: done?", {});
    const r4 = await kvGet(turnKey(ISSUE, THREAD));
    evidence.rowAfterTurn4 = r4 && { skillIds: r4.skillIds, updatedAt: r4.updatedAt };
    check("an inherited [] is not a reason to fall back: the row is STILL []", !!r4 && Array.isArray(r4.skillIds) && r4.skillIds.length === 0, { stored: r4 && r4.skillIds });
    check("turn 4 injected no skills either", !skillsInjected(t4), { line: t4 && t4.injected });
    check("the row was rewritten by turn 4 (so the [] above is this turn's answer, not a stale read)",
      !!r4 && !!r3 && r4.updatedAt !== r3.updatedAt, { turn3: r3 && r3.updatedAt, turn4: r4 && r4.updatedAt });
  } finally {
    for (let i = 0; i < 3; i++) {
      const back = await kvSet(PROVIDER_SLOT, providerBefore === null ? null : providerBefore);
      if (back.status === 200) break;
      await sleep(3000);
    }
    const now = await kvGet(PROVIDER_SLOT);
    check(`${PROVIDER_SLOT} restored to its recorded value`, JSON.stringify(now) === JSON.stringify(providerBefore), { now: mask(now), before: mask(providerBefore) });
    fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(evidence, null, 2));
    console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} — evidence at ${OUT}/evidence.json`);
  }
};

await main();
process.exit(failures === 0 ? 0 : 1);
