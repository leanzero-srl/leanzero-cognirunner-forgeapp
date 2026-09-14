/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-631 — A THREAD WHOSE PICKER HOLDS A SKILL THAT CANNOT BE RENDERED MUST NOT
 * RE-PIN ON EVERY TURN.
 *
 * THE DEFECT F-630 LEFT. The pin stored the APPLIED skill ids (`fetchSkillsBlock`'s
 * receipt) and the turn compared its REQUESTED ids against them. A disabled skill never
 * reaches the applied list, so a thread whose picker keeps posting [A, B] with B disabled
 * compared [A] against [A, B] forever: `skills changed by the turn` on EVERY turn, the pin
 * dropped and rebuilt every time, the whole prefix (field guide + history) re-billed at
 * write price — and travelling the F-615 INFO path, so no DEFECT WARN ever fired.
 *
 * THE PROOF, ON ONE LIVE THREAD:
 *   turn 1  skillIds:[A,B], both enabled → the pin holds both, applied AND requested.
 *   DISABLE B through the admin panel's own Skills tab (Playwright, the product's
 *           `deleteSkill` builtin-disable path — never a planted KVS row).
 *   turn 2  the picker UNCHANGED, still [A,B] → the skill EPOCH moved (a disable flips
 *           `on`→`off` in `skillEpochFor`), so ONE re-pin is correct and expected. What
 *           must NOT appear, then or ever, is `skills changed by the turn`.
 *   turn 3  the picker UNCHANGED again → now nothing moves: no re-pin line at all, a
 *           NON-ZERO first-round cache read, and a pin whose stored ids did not change.
 *   RE-ENABLE B, turn 4 → B is no longer in the pin's applied ids, so re-enabling it does
 *           not move the pin's epoch; the turn injects it through `skillsExtraBlock`
 *           AFTER the history. Evidence: the turn's receipt names B again while the PIN
 *           still holds only A, and the prefix still cached.
 *
 * RESTORE: B is re-enabled in the `finally` and the state is proven by a second read of
 * `getSkills`; the provider slot is recorded MASKED and put back. Writes nothing to Jira
 * — the hook forces `simulation:true` on every startCoderTurn (F-387).
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { loadEnv } from "../lib/env.mjs";
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { formatResultLine, resultExitCode, runProvenance } from "../lib/driver-report.mjs";

const { envName: ENV_NAME, hookUrl: URL_, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["providerSlot", "skills", "kvs"], defaultEnv: "staging" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const SECRET = env.HARNESS_SECRET;
const ACCT = env.HARNESS_ADMIN_ACCOUNT_ID;
const ISSUE = arg("issue", "LZPT-186");
const SLOT = "COGNIRUNNER_AI_PROVIDER";
const THREAD = `t_f631_${Date.now().toString(36)}`;
const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const ENV_ID = arg("envid", ENV_ID_DEFAULT);
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const OUT = new URL("../results/coder-pin-kept", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
let crashed = null;   /* F-792 — set by main()'s catch; the RESULT line reads it */
const ev = { at: new Date().toISOString(), issue: ISSUE, thread: THREAD, checks: [], turns: {} };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const note = (s, d) => { console.log(`  NOTE  ${s} ${JSON.stringify(d)}`); };
const mask = (v) => (v === null || v === undefined ? String(v) : `${String(v).slice(0, 2)}***(len ${String(v).length})`);

const post = async (body) => {
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const t = await res.text(); let b = null; try { b = JSON.parse(t); } catch { b = { raw: t.slice(0, 200) }; }
  return { status: res.status, body: b };
};
const call = async (fk, payload = {}) => (await post({ action: "invokeResolver", functionKey: fk, accountId: ACCT, payload })).body;
const kvGet = async (key) => {
  const r = await fetch(`${URL_}?what=kvs&key=${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${SECRET}` } });
  const b = await r.json(); return b && b.value !== undefined ? b.value : null;
};
const kvSet = (key, value) => post({ action: "kvSet", key, value });
const pinKey = () => `coder_pin:${ISSUE}:${THREAD}`;

/** Flip a skill's enabled state through the admin panel's OWN Skills tab. */
async function toggleSkillInUI(skillName, wantEnable) {
  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1600, height: 1300 } });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(`${BASE}/jira/apps/${APP}/${ENV_ID}`, { waitUntil: "domcontentloaded" });
    let frame = null;
    for (let i = 0; i < 90; i++) {
      frame = page.frames().find((f) => f.url().includes("cdn.prod.atlassian-dev.net"));
      if (frame && (await frame.locator(".tab-btn").count()) > 0) break;
      await sleep(1000);
    }
    if (!frame) throw new Error("the admin panel iframe never appeared");
    await frame.locator(".tab-btn", { hasText: /^\s*Skills\s*$/ }).click();
    await frame.locator("tr", { hasText: skillName }).first().waitFor({ state: "visible", timeout: 60000 });
    await sleep(1200);
    const row = frame.locator("tr", { hasText: skillName }).first();
    const label = wantEnable ? "Enable" : "Disable";
    const btn = row.locator("button.btn-small", { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
    if (!(await btn.count())) { await page.screenshot({ path: `${OUT}/skills-tab-nobutton.png` }).catch(() => {}); throw new Error(`no "${label}" button on the row for ${skillName}`); }
    await btn.click();
    await sleep(4000);
    await page.screenshot({ path: `${OUT}/skills-${wantEnable ? "enabled" : "disabled"}.png` }).catch(() => {});
    return true;
  } finally { await ctx.close(); }
}

const TERMINAL = new Set(["done", "error", "failed", "complete", "completed"]);
const runTurn = async (label, message, extra) => {
  const r = await call("startCoderTurn", { issueKey: ISSUE, threadId: THREAD, message, ...extra });
  if (!r || r.success !== true || !r.taskId) { FAIL(`${label}: the turn was queued`, { answer: JSON.stringify(r).slice(0, 200) }); return null; }
  let res = null;
  for (let i = 0; i < 90; i++) {
    const p = await call("getAsyncTaskResult", { taskId: r.taskId });
    if (p && p.status && TERMINAL.has(String(p.status))) { res = p; break; }
    await sleep(5000);
  }
  if (!res || String(res.status) !== "done") { FAIL(`${label}: the turn reached "done"`, { status: res && res.status }); return null; }
  const inner = res.result || {};
  const logs = (inner.logs || []).map(String);
  const usage = inner.usage || {};
  const t = {
    label, logs, knowledge: inner.knowledge || null,
    rounds: Number(inner.rounds) || 0,
    first: Number(usage.firstRoundCacheReadTokens) || 0,
    total: Number(usage.cacheReadTokens) || 0,
    pinLines: logs.filter((l) => /pin re-built|pin expired|DEFECT|skills changed by the turn/i.test(l)),
    knowledgeLine: logs.find((l) => /Knowledge injected/i.test(l)) || null,
  };
  ev.turns[label] = { rounds: t.rounds, first: t.first, total: t.total, pinLines: t.pinLines.map((l) => l.slice(0, 300)), knowledge: t.knowledge, knowledgeLine: t.knowledgeLine };
  note(`${label}`, { rounds: t.rounds, firstRoundCacheRead: t.first, knowledge: t.knowledge, pinLines: t.pinLines.map((l) => l.slice(0, 140)) });
  return t;
};
const noPickerChangeLine = (t) => !(t.logs || []).some((l) => /skills changed by the turn/i.test(l));

async function main() {
  /* F-741 — the tenant name comes from the guard's settled row. This said STAGING outright
     while `--env` was free to move the run to dev, so the banner named a tenant the run was
     not on and a reader triaging the FAIL looked in the wrong place. */
  console.log(`\nF-631 — a disabled skill in a thread's picker must not re-pin every turn (${ENV_NAME.toUpperCase()}, thread ${THREAD})\n`);
  const providerBefore = await kvGet(SLOT);
  console.log(`recorded ${SLOT} before the flip: ${mask(providerBefore)}`);
  let skillB = null, disabled = false;
  try {
    await kvSet(SLOT, "managed");
    console.log("waiting 40s for the ~30s provider cache…");
    await sleep(40000);
    const cap = await call("getAgentCapability");
    if (cap.enabled !== true) { FAIL("the Coder is enabled on the managed engine", { reason: cap.reason }); return; }
    PASS('the Coder is ENABLED on the managed engine (reason "managed")', { reason: cap.reason, edition: cap.edition });

    const sk = await call("getSkills");
    const all = (sk && sk.skills) || [];
    const enabled = all.filter((s) => s && s.id && s.enabled !== false);
    if (enabled.length < 2) { FAIL("two enabled skills are needed", { enabled: enabled.length }); return; }
    const A = enabled[0], B = enabled[1];
    skillB = B;
    ev.skills = { A: { id: A.id, name: A.name, builtin: !!A.builtin }, B: { id: B.id, name: B.name, builtin: !!B.builtin } };
    PASS("two enabled skills picked from this instance's own store", ev.skills);

    /* ── turn 1 — the pin is written with BOTH ─────────────────────────────── */
    console.log("\nTURN 1 — skillIds:[A,B], both enabled");
    const t1 = await runTurn("turn1", "In one sentence, what is this issue about?", { skillIds: [A.id, B.id] });
    if (!t1) return;
    const pin1 = await kvGet(pinKey());
    ev.pinAfterTurn1 = pin1 && { skillIds: pin1.skillIds, requestedSkillIds: pin1.requestedSkillIds, skillEpoch: pin1.skillEpoch };
    const bothApplied = pin1 && Array.isArray(pin1.skillIds) && [A.id, B.id].every((i) => pin1.skillIds.includes(i));
    const bothRequested = pin1 && Array.isArray(pin1.requestedSkillIds) && [A.id, B.id].every((i) => pin1.requestedSkillIds.includes(i));
    if (bothApplied && bothRequested) PASS("the pin holds BOTH skills, applied AND requested (F-631's two lists)", ev.pinAfterTurn1);
    else FAIL("the pin does not hold both skills", ev.pinAfterTurn1);

    /* ── the disable, through the product's own admin UI ───────────────────── */
    console.log(`\nDISABLE "${B.name}" through the admin panel's Skills tab`);
    await toggleSkillInUI(B.name, false);
    disabled = true;
    const afterDisable = ((await call("getSkills")).skills || []).find((s) => s.id === B.id);
    if (afterDisable && afterDisable.enabled === false) PASS("SECOND READ: the skill is disabled in the store", { id: B.id, enabled: afterDisable.enabled });
    else { FAIL("the skill is not disabled — the rest of this run would prove nothing", { row: JSON.stringify(afterDisable || null).slice(0, 200) }); return; }
    console.log("waiting 35s (the 30s caches)…");
    await sleep(35000);

    /* ── turn 2 — the picker UNCHANGED ────────────────────────────────────── */
    console.log("\nTURN 2 — the picker unchanged, still [A,B], with B now disabled");
    const t2 = await runTurn("turn2", "Add one more sentence about the risk.", { skillIds: [A.id, B.id] });
    if (!t2) return;
    if (noPickerChangeLine(t2)) PASS("F-631: turn 2 does NOT say `skills changed by the turn` — the request is compared with the request, not with what rendered", { pinLines: t2.pinLines.map((l) => l.slice(0, 160)) });
    else FAIL("F-631: turn 2 claims the picker changed when it did not", { lines: t2.pinLines.map((l) => l.slice(0, 240)) });
    note("turn 2's pin lines (a skillEpoch re-pin here is the CORRECT one-time price of the disable)", { lines: t2.pinLines.map((l) => l.slice(0, 200)) });

    /* ── turn 3 — the picker UNCHANGED again: now nothing may move ─────────── */
    console.log("\nTURN 3 — the picker unchanged again; the thread must now be STABLE");
    const pinBefore3 = await kvGet(pinKey());
    const t3 = await runTurn("turn3", "One more line, please.", { skillIds: [A.id, B.id] });
    if (!t3) return;
    if (noPickerChangeLine(t3)) PASS("F-631: turn 3 does NOT say `skills changed by the turn` either — THE PIN IS KEPT", { pinLines: t3.pinLines.map((l) => l.slice(0, 160)) });
    else FAIL("F-631: turn 3 re-pins on an unchanged picker — this is the every-turn rebuild", { lines: t3.pinLines.map((l) => l.slice(0, 240)) });
    if (t3.pinLines.length === 0) PASS("turn 3 logged NO pin rebuild of any kind (the disable was paid for exactly once)");
    else FAIL("turn 3 still rebuilt the pin", { lines: t3.pinLines.map((l) => l.slice(0, 240)) });
    if (t3.first > 0) PASS("turn 3's FIRST round read a NON-ZERO number of cached tokens — the prefix really did stay put", { firstRoundCacheReadTokens: t3.first });
    else FAIL("turn 3 read nothing from cache — the prefix moved", { firstRoundCacheReadTokens: t3.first });
    const pinAfter3 = await kvGet(pinKey());
    ev.pinAfterTurn3 = pinAfter3 && { skillIds: pinAfter3.skillIds, requestedSkillIds: pinAfter3.requestedSkillIds };
    const stable = JSON.stringify(pinBefore3 && { s: pinBefore3.skillIds, r: pinBefore3.requestedSkillIds, b: (pinBefore3.skillsBlock || "").length })
      === JSON.stringify(pinAfter3 && { s: pinAfter3.skillIds, r: pinAfter3.requestedSkillIds, b: (pinAfter3.skillsBlock || "").length });
    if (stable) PASS("SECOND READ: the pin's ids and rendered bytes are unchanged across turn 3", ev.pinAfterTurn3);
    else FAIL("the pin changed across turn 3", { before: pinBefore3 && pinBefore3.skillIds, after: pinAfter3 && pinAfter3.skillIds });

    /* ── re-enable, and the skill returns through the EXTRA block ──────────── */
    console.log(`\nRE-ENABLE "${B.name}" through the admin panel's Skills tab`);
    await toggleSkillInUI(B.name, true);
    disabled = false;
    const afterEnable = ((await call("getSkills")).skills || []).find((s) => s.id === B.id);
    if (afterEnable && afterEnable.enabled !== false) PASS("SECOND READ: the skill is enabled again in the store", { id: B.id });
    else FAIL("the skill did not come back", { row: JSON.stringify(afterEnable || null).slice(0, 200) });
    console.log("waiting 35s (the 30s caches)…");
    await sleep(35000);
    console.log("\nTURN 4 — the picker still [A,B], with B enabled again");
    const t4 = await runTurn("turn4", "And a final line.", { skillIds: [A.id, B.id] });
    if (!t4) return;
    const receiptIds = (t4.knowledge && (t4.knowledge.skillIds || t4.knowledge.skills)) || [];
    const pin4 = await kvGet(pinKey());
    ev.pinAfterTurn4 = pin4 && { skillIds: pin4.skillIds, requestedSkillIds: pin4.requestedSkillIds };
    const backInReceipt = Array.isArray(receiptIds) ? receiptIds.map(String).includes(String(B.id)) : JSON.stringify(t4.knowledge || "").includes(B.id);
    if (backInReceipt) PASS("the re-enabled skill is in turn 4's knowledge receipt again", { receipt: t4.knowledge });
    else FAIL("the re-enabled skill did not come back into the turn", { receipt: t4.knowledge, line: t4.knowledgeLine });
    const stillOutOfPin = pin4 && Array.isArray(pin4.skillIds) && !pin4.skillIds.includes(B.id);
    if (backInReceipt && stillOutOfPin) PASS("…and it came through the EXTRA block, not the prefix: the PIN still holds only the other skill", ev.pinAfterTurn4);
    else if (backInReceipt) NV("the skill returned, but the pin now holds it too — that is a rebuild, not the extra-block path", ev.pinAfterTurn4);
    if (t4.first > 0) PASS("turn 4's first round STILL read cached tokens — the extra block sits after the prefix and does not move it", { firstRoundCacheReadTokens: t4.first });
    else FAIL("turn 4 read nothing from cache", { firstRoundCacheReadTokens: t4.first });
  } catch (e) {
    /* F-792 — the RESULT line below prints from the `finally`, so the RESTORE block can report
       its own residue after it. That also means it prints on the CRASH path, with the counters
       frozen wherever the throw left them — which is how a dead run says "0 fail". Catching
       here is what lets the line SAY it crashed. Deliberately no rethrow: the finally's restore
       and its residue assertions must still run and still be the last word. */
    crashed = e;
    console.error("\nDRIVER ERROR:", e && e.stack);
  } finally {
    console.log("\nRESTORE");
    if (disabled && skillB) {
      try { await toggleSkillInUI(skillB.name, true); } catch (e) { FAIL("the re-enable UI failed — RESTORE BY HAND", { skill: skillB.id, error: String(e.message).slice(0, 200) }); }
    }
    if (skillB) {
      const row = ((await call("getSkills")).skills || []).find((s) => s.id === skillB.id);
      if (row && row.enabled !== false) PASS("SECOND READ: the skill this run touched is ENABLED again", { id: skillB.id });
      else FAIL("THE SKILL IS STILL DISABLED — restore it in the Skills tab", { id: skillB.id, row: JSON.stringify(row || null).slice(0, 200) });
    }
    for (let i = 0; i < 3; i++) { const back = await kvSet(SLOT, providerBefore === null ? null : providerBefore); if (back.status === 200) break; await sleep(3000); }
    const now = await kvGet(SLOT);
    if (JSON.stringify(now) === JSON.stringify(providerBefore)) PASS(`${SLOT} restored to its recorded value`, { now: mask(now) });
    else FAIL(`${SLOT} NOT restored`, { now: mask(now), before: mask(providerBefore) });
    /* F-787 — WHICH COMMIT PRODUCED THIS FILE. Evidence is read weeks later beside a findings row; `dirty` is reported because evidence made from uncommitted edits is not reproducible from the commit it names. */
    ev.provenance = runProvenance();
    fs.writeFileSync(`${OUT}/evidence.json`, JSON.stringify(ev, null, 2));
    console.log("\n" + formatResultLine({ passes, fails, unproven, crashed, suffix: `. Evidence: ${OUT}/evidence.json` }));
    process.exitCode = resultExitCode({ fails, crashed }) || process.exitCode;
  }
}
await main();
