/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/*
 * F-644 + F-643 LIVE PROOF on the MANAGED engine (OpenAI-shaped wire, OpenRouter).
 *
 * F-644 cut the wire shape: an assistant row with `tool_calls` is sent with NO `content`
 * key, and an EMPTY model turn is neither stored nor replayed. That is only provable with
 * a turn that actually CALLS TOOLS (so assistant+tool rows exist), followed by a SECOND
 * turn on the SAME thread (so those stored rows are replayed through `toModelMessage`).
 * A single-round turn proves nothing about either.
 *
 * F-643 gave the turn's own `usage` a new counter, `cacheMarksEmitted` — the number of
 * `cache_control` markers the ADAPTER really put on the wire, not the number the placement
 * helper declared. Turn 1 (empty history) must emit >= 1; a turn WITH history must emit
 * >= 2 (the cross-turn boundary and the within-turn one). F-636 is re-asserted on the same
 * run: turn 2's FIRST round must read a non-zero cross-turn cache.
 *
 * Writes nothing to Jira: the test hook forces `simulation: true` on every startCoderTurn
 * (F-387), and the prompts only read. The provider and agent-model slots are recorded
 * MASKED and restored in a `finally`, then read back a second time.
 *
 * Usage: node scripts/coder-wire-replay-live.mjs [--issue=LZPT-186] [--thread=<id>]
 */
import fs from "node:fs";
import { loadEnv } from "../lib/env.mjs";

const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const URL_ = env.STAGING_TESTSTATE_URL || "";
const SECRET = env.HARNESS_SECRET;
const ACCT = env.HARNESS_ADMIN_ACCOUNT_ID;
const ISSUE = arg("issue", "LZPT-186");
const THREAD = arg("thread", `t_f644_${Date.now().toString(36)}`);
const PROVIDER_SLOT = "COGNIRUNNER_AI_PROVIDER";
const AGENT_MODEL_SLOT = "COGNIRUNNER_AGENT_MODEL_managed";
const OUT = new URL("../results/coder-wire-replay", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (v) => (v === null || v === undefined ? String(v) : `${String(v).slice(0, 2)}***(len ${String(v).length})`);
const post = async (body) => {
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const t = await res.text(); let b = null; try { b = JSON.parse(t); } catch { b = { raw: t.slice(0, 200) }; }
  return { status: res.status, body: b };
};
const call = async (functionKey, payload = {}) => (await post({ action: "invokeResolver", functionKey, accountId: ACCT, payload })).body;
const kvGet = async (key) => {
  const r = await fetch(`${URL_}?what=kvs&key=${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${SECRET}` } });
  const b = await r.json(); return b && b.value !== undefined ? b.value : null;
};
const kvSet = (key, value) => post({ action: "kvSet", key, value });

const TERMINAL = new Set(["done", "error", "failed", "complete", "completed"]);
const runTurn = async (label, message) => {
  const started = Date.now();
  const r = await call("startCoderTurn", { issueKey: ISSUE, threadId: THREAD, message });
  if (!r || r.success !== true || !r.taskId) throw new Error(`${label}: not queued — ${JSON.stringify(r).slice(0, 300)}`);
  let res = null;
  for (let i = 0; i < 100; i++) {
    const p = await call("getAsyncTaskResult", { taskId: r.taskId });
    if (p && p.status && TERMINAL.has(String(p.status))) { res = p; break; }
    await sleep(5000);
  }
  if (!res) throw new Error(`${label}: never reached a terminal status in 500s`);
  const inner = (res && res.result) || {};
  const usage = inner.usage || {};
  const logs = (inner.logs || []).map(String);
  const row = {
    label, taskId: r.taskId, status: String(res.status), wallMs: Date.now() - started,
    success: inner.success === true, endedBy: inner.endedBy || null, error: inner.error || null,
    rounds: Number(inner.rounds) || 0,
    actions: Array.isArray(inner.actions) ? inner.actions.map((a) => (a && (a.action || a.name || a.what)) || "?") : [],
    usage: {
      cacheMarksEmitted: Number(usage.cacheMarksEmitted),
      firstRoundCacheReadTokens: Number(usage.firstRoundCacheReadTokens) || 0,
      cacheReadTokens: Number(usage.cacheReadTokens) || 0,
      tokens: Number(usage.tokens) || 0,
    },
    reply: String(inner.reply || "").slice(0, 300),
    notableLogs: logs.filter((l) => /cache|DEFECT|empty model message|pin re-built|4\d\d|error|refus/i.test(l)).map((l) => l.slice(0, 400)),
  };
  console.log(`\n[${label}] status=${row.status} success=${row.success} endedBy=${row.endedBy} rounds=${row.rounds}`);
  console.log(`[${label}] actions=${JSON.stringify(row.actions)}`);
  console.log(`[${label}] usage=${JSON.stringify(row.usage)}`);
  if (row.error) console.log(`[${label}] ERROR: ${row.error}`);
  if (row.notableLogs.length) console.log(`[${label}] logs: ${JSON.stringify(row.notableLogs, null, 1)}`);
  return row;
};

const ev = { at: new Date().toISOString(), issue: ISSUE, thread: THREAD, turns: [], checks: [] };
const check = (id, ok, detail) => { ev.checks.push({ id, verdict: ok ? "PASS" : "FAIL", detail }); console.log(`  ${ok ? "PASS" : "FAIL"}  ${id} — ${detail}`); };

const providerBefore = await kvGet(PROVIDER_SLOT);
const agentModelBefore = await kvGet(AGENT_MODEL_SLOT);
ev.slotsBefore = { [PROVIDER_SLOT]: mask(providerBefore), [AGENT_MODEL_SLOT]: mask(agentModelBefore) };
console.log(`recorded ${PROVIDER_SLOT} before: ${mask(providerBefore)}`);
console.log(`recorded ${AGENT_MODEL_SLOT} before: ${mask(agentModelBefore)}`);

try {
  await kvSet(PROVIDER_SLOT, "managed");
  console.log("waiting 40s for the ~30s provider cache…");
  await sleep(40000);
  const cap = await call("getAgentCapability");
  ev.capability = { enabled: cap && cap.enabled, reason: cap && cap.reason };
  console.log(`coder enabled=${cap && cap.enabled} reason=${cap && cap.reason}`);
  if (!cap || cap.enabled !== true) throw new Error("the Coder is not enabled — this run would prove nothing");

  // TURN 1 — a CHAINED tool task: the second call cannot be made until the first has
  // answered, so the loop is forced through at least three rounds and the thread ends up
  // holding real assistant(tool_calls) + tool rows.
  const t1 = await runTurn("turn1", [
    `Do this in order, using the tools, never guessing:`,
    `1. Call search_issues with jql "project = ${ISSUE.split("-")[0]} ORDER BY created DESC" and maxResults 5.`,
    `2. Take the FIRST issue key from that result and call get_issue on exactly that key.`,
    `3. Then finish, reporting that key and its status in one line.`,
  ].join("\n"));
  ev.turns.push(t1);

  // TURN 2 — the SAME thread. Everything turn 1 stored is now replayed through
  // `toModelMessage`; this is the turn that would 400 on a poisoned/empty row and the
  // turn whose first round must read the cross-turn cache.
  const t2 = await runTurn("turn2", "Using the tools again, call get_issue on the same key you just reported and tell me its issue type and how many comments it has. Then finish.");
  ev.turns.push(t2);

  // ---- the second read: the THREAD ROW as stored, not as reported.
  const threadKey = `coder_thread:${ISSUE}:${THREAD}`;
  const row = await kvGet(threadKey);
  const msgs = (row && Array.isArray(row.messages)) ? row.messages : [];
  ev.threadKey = threadKey;
  ev.threadShape = msgs.map((m, i) => ({
    i, role: m && m.role, kind: (m && m.kind) || null,
    hasContentKey: !!(m && Object.prototype.hasOwnProperty.call(m, "content")),
    contentType: m && typeof m.content,
    contentLen: m && typeof m.content === "string" ? m.content.length : null,
    toolCalls: m && Array.isArray(m.tool_calls) ? m.tool_calls.map((c) => (c && c.function && c.function.name) || "?") : null,
    toolCallId: !!(m && m.tool_call_id),
  }));
  ev.threadTurns = row && row.turns;

  // ---- checks
  check("F644-1 turn1 completed", t1.success === true && t1.status === "done" && !t1.error, `status=${t1.status} endedBy=${t1.endedBy}`);
  check("F644-2 turn1 used >= 2 rounds (a tool round really executed)", t1.rounds >= 2, `rounds=${t1.rounds}`);
  const t1Tools = ev.threadShape.filter((m) => m.toolCalls && m.toolCalls.length).length;
  check("F644-3 the thread holds assistant rows carrying tool_calls", t1Tools >= 1, `${t1Tools} assistant row(s) with tool_calls: ${JSON.stringify(ev.threadShape.filter((m) => m.toolCalls).map((m) => m.toolCalls))}`);
  check("F644-4 turn2 completed — the stored rows replayed through toModelMessage without a provider refusal", t2.success === true && t2.status === "done" && !t2.error, `status=${t2.status} endedBy=${t2.endedBy}`);
  const emptyNoTools = ev.threadShape.filter((m) => m.contentLen === 0 && !(m.toolCalls && m.toolCalls.length));
  check("F644-5 no stored message with content:\"\" and no tool_calls", emptyNoTools.length === 0, `${emptyNoTools.length} such row(s): ${JSON.stringify(emptyNoTools)}`);
  const anyEmptyString = ev.threadShape.filter((m) => m.contentLen === 0);
  check("F644-6 (stricter) no stored message with content:\"\" at all", anyEmptyString.length === 0, `${anyEmptyString.length} such row(s): ${JSON.stringify(anyEmptyString)}`);

  check("F643-1 turn1 usage carries cacheMarksEmitted", Number.isFinite(t1.usage.cacheMarksEmitted), `value=${t1.usage.cacheMarksEmitted}`);
  check("F643-2 turn1 (no history) emitted >= 1 cache mark", t1.usage.cacheMarksEmitted >= 1, `cacheMarksEmitted=${t1.usage.cacheMarksEmitted}`);
  check("F643-3 turn2 (with history) emitted >= 2 cache marks", t2.usage.cacheMarksEmitted >= 2, `cacheMarksEmitted=${t2.usage.cacheMarksEmitted}`);
  check("F636 turn2 first round read a non-zero cross-turn cache", t2.usage.firstRoundCacheReadTokens > 0, `firstRoundCacheReadTokens=${t2.usage.firstRoundCacheReadTokens} allRounds=${t2.usage.cacheReadTokens}`);
  const defects = [...t1.notableLogs, ...t2.notableLogs].filter((l) => /DEFECT/.test(l));
  check("no DEFECT line in either turn's own log", defects.length === 0, defects.length ? JSON.stringify(defects) : "none");
} catch (e) {
  ev.fatal = String((e && e.message) || e);
  console.log(`\nFATAL: ${ev.fatal}`);
} finally {
  for (const [slot, before] of [[PROVIDER_SLOT, providerBefore], [AGENT_MODEL_SLOT, agentModelBefore]]) {
    for (let i = 0; i < 3; i++) { const back = await kvSet(slot, before === null ? null : before); if (back.status === 200) break; await sleep(3000); }
  }
  const providerNow = await kvGet(PROVIDER_SLOT);
  const agentModelNow = await kvGet(AGENT_MODEL_SLOT);
  ev.slotsRestored = {
    [PROVIDER_SLOT]: { restored: JSON.stringify(providerNow) === JSON.stringify(providerBefore), now: mask(providerNow) },
    [AGENT_MODEL_SLOT]: { restored: JSON.stringify(agentModelNow) === JSON.stringify(agentModelBefore), now: mask(agentModelNow) },
  };
  console.log(`\n${PROVIDER_SLOT} restored: ${ev.slotsRestored[PROVIDER_SLOT].restored ? "YES" : "NO"} (${ev.slotsRestored[PROVIDER_SLOT].now})`);
  console.log(`${AGENT_MODEL_SLOT} restored: ${ev.slotsRestored[AGENT_MODEL_SLOT].restored ? "YES" : "NO"} (${ev.slotsRestored[AGENT_MODEL_SLOT].now})`);
  const failed = ev.checks.filter((c) => c.verdict === "FAIL");
  ev.verdict = ev.fatal ? "FAIL (fatal)" : failed.length ? `FAIL (${failed.length}/${ev.checks.length})` : `PASS (${ev.checks.length}/${ev.checks.length})`;
  fs.writeFileSync(`${OUT}/evidence.json`, JSON.stringify(ev, null, 2));
  console.log(`\nVERDICT ${ev.verdict}`);
  console.log(`evidence: ${OUT}/evidence.json`);
}
