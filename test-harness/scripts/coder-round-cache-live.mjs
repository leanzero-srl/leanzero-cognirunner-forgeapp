/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/*
 * F-641 BASELINE — WHAT THE LATER ROUNDS OF ONE TURN READ FROM CACHE.
 *
 * F-641 says F-636 bought the CROSS-TURN breakpoint by giving up the WITHIN-TURN one, so
 * on the FIRST turn of a thread rounds 2..N re-bill the fenced issue context at full
 * price. `coder-skill-inherit-live.mjs` cannot see it: its four prompts are answered in
 * ONE round each, and a turn with no round 2 says nothing about rounds 2+.
 *
 * So this drives ONE turn of a FRESH thread with a prompt that forces tool calls, and
 * records `rounds`, `firstRoundCacheReadTokens` and `cacheReadTokensAllRounds` from the
 * turn's own returned `usage`. Rounds 2..N are the difference — the only breakdown the
 * product exposes. It GRADES NOTHING about F-641 (the row is being cut); it measures.
 *
 * Writes nothing: the hook forces `simulation:true` on every startCoderTurn (F-387).
 * The provider slot is recorded MASKED and restored in a `finally`.
 */
import fs from "node:fs";
import { loadEnv } from "../lib/env.mjs";
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
const { hookUrl: URL_ } = requireEnvAck(process.argv.slice(2), { faults: [], defaultEnv: "staging" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const SECRET = env.HARNESS_SECRET;
const ACCT = env.HARNESS_ADMIN_ACCOUNT_ID;
const ISSUE = arg("issue", "LZPT-186");
const SLOT = "COGNIRUNNER_AI_PROVIDER";
const THREAD = `t_f641_${Date.now().toString(36)}`;
const OUT = new URL("../results/coder-round-cache", import.meta.url).pathname;
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

const ev = { at: new Date().toISOString(), issue: ISSUE, thread: THREAD };
const before = await kvGet(SLOT);
console.log(`recorded ${SLOT} before the flip: ${mask(before)}`);
try {
  await kvSet(SLOT, "managed");
  console.log("waiting 40s for the ~30s provider cache…");
  await sleep(40000);
  const cap = await call("getAgentCapability");
  console.log(`coder enabled=${cap.enabled} reason=${cap.reason}`);
  if (cap.enabled !== true) throw new Error("the Coder is not enabled — this run would prove nothing");
  const r = await call("startCoderTurn", {
    issueKey: ISSUE, threadId: THREAD,
    message: "Read this issue with the workspace tools and then tell me, in one line each, its status, its summary and how many comments it has. Use the tools, do not guess.",
  });
  if (!r || r.success !== true || !r.taskId) throw new Error(`the turn was not queued: ${JSON.stringify(r).slice(0, 200)}`);
  const TERMINAL = new Set(["done", "error", "failed", "complete", "completed"]);
  let res = null;
  for (let i = 0; i < 90; i++) {
    const p = await call("getAsyncTaskResult", { taskId: r.taskId });
    if (p && p.status && TERMINAL.has(String(p.status))) { res = p; break; }
    await sleep(5000);
  }
  const inner = (res && res.result) || {};
  const usage = inner.usage || {};
  const rounds = Number(inner.rounds) || 0;
  const first = Number(usage.firstRoundCacheReadTokens) || 0;
  const total = Number(usage.cacheReadTokens) || 0;
  const logs = (inner.logs || []).map(String);
  ev.status = res && res.status;
  ev.measurement = { rounds, round1CacheRead: first, allRoundsCacheRead: total, rounds2PlusCacheRead: total - first, tokens: Number(usage.tokens) || 0 };
  ev.cacheLines = logs.filter((l) => /cache|DEFECT|pin re-built/i.test(l)).map((l) => l.slice(0, 300));
  ev.toolCalls = logs.filter((l) => /tool|workspace|read/i.test(l)).length;
  console.log(`\nstatus=${ev.status}`);
  console.log(`MEASURED  ${JSON.stringify(ev.measurement)}`);
  if (rounds < 2) console.log("NOTE  this turn still finished in ONE round — rounds 2+ are not measurable from it");
  if (ev.cacheLines.length) console.log(`cache lines: ${JSON.stringify(ev.cacheLines)}`);
} finally {
  for (let i = 0; i < 3; i++) { const back = await kvSet(SLOT, before === null ? null : before); if (back.status === 200) break; await sleep(3000); }
  const now = await kvGet(SLOT);
  console.log(`${SLOT} restored: ${JSON.stringify(now) === JSON.stringify(before) ? "YES" : "NO"} (${mask(now)})`);
  ev.slotRestored = JSON.stringify(now) === JSON.stringify(before);
  fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
  console.log(`evidence: ${OUT}/evidence.json`);
}
