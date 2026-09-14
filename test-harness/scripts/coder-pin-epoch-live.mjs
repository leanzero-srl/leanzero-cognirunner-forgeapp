/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-578 — A PINNED CODER PREFIX IS REPLAYED ONLY WHILE THE KNOWLEDGE IT FROZE IS TRUE.
 *
 * WHAT IS ACTUALLY PROVEN, AND BY WHICH SECOND READ.
 *   1. After two turns of one thread, `coder_pin:{issue}:{thread}` carries `memoryEpoch`
 *      AND `skillIds` — read straight off KVS through the hook's `?what=kvs` GET, not
 *      inferred from a log line.
 *   2. A memory ADDED before turn 1 is inside the pinned `memoryBlock` (the same read).
 *      That is what makes step 3 a measurement: the line is provably in the prefix first.
 *   3. DELETING it bumps `COGNIRUNNER_MEMORY_EPOCH` (read before and after), and the NEXT
 *      turn logs `this thread's knowledge changed since it was pinned (memoryEpoch N→N+1)`
 *      on the turn's own execution log, `[coder] pin invalidated: memoryEpoch N→N+1` on
 *      forge logs, and REWRITES the pin row with the new epoch and WITHOUT the line.
 *   4. The prefix really moved: the invalidating turn's FIRST-ROUND cache read drops below
 *      the previous turn's, and the turn after it climbs back. Managed = OpenRouter, which
 *      is one of the two providers this app marks cache breakpoints for, so the number is
 *      real. This is reported as a MEASUREMENT even when it does not drop — a provider-side
 *      cache miss is not an app defect and must not be scored as one.
 *   5. F-598 CONTROL: a memory added afterwards, scoped to ANOTHER project, must not
 *      invalidate anything — `memoryEpochShouldBump` does not bump on an add, and
 *      `buildMemoryBlock` filters a foreign projectKey out. Recorded, not assumed.
 *
 * WHY MANAGED, AND WHY STAGING. Staging carries the Coder (advanced) edition; the managed
 * engine turns the Coder on without a frontier agent-model slot (every MANAGED_MODELS id is
 * frontier) and it bills — and discounts — cache reads, which item 4 needs. Development is
 * Standard and refuses the Coder outright.
 *
 * NOTHING IS WRITTEN TO A REPOSITORY. `src/test-hook.js` overwrites `simulation:true` on
 * every `startCoderTurn` it forwards (F-387). The turns spend managed tokens; that is a
 * cost, not a write.
 *
 * RESTORE. The provider slot is recorded BEFORE the flip (value masked in the output) and
 * put back in a `finally` that retries; the probe memories are deleted on every exit path.
 *
 * Usage (from test-harness/):
 *   node scripts/coder-pin-epoch-live.mjs
 *   node scripts/coder-pin-epoch-live.mjs --issue=LZPT-186
 *
 * Env: STAGING_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID. Nothing secret
 * is printed — not the trigger URL, not the Bearer, not the provider slot's old value.
 */
import fs from "node:fs";
import { loadEnv } from "../lib/env.mjs";

const { hookUrl: URL_ } = requireEnvAck(process.argv.slice(2), { faults: [], defaultEnv: "staging" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const SECRET = env.HARNESS_SECRET;
const ACCT = process.env.HARNESS_ADMIN_ACCOUNT_ID || env.HARNESS_ADMIN_ACCOUNT_ID;
const ISSUE = arg("issue", "LZPT-186");
const OTHER_PROJECT = arg("other", "COGTEST");
const PROVIDER_SLOT = "COGNIRUNNER_AI_PROVIDER";
const EPOCH_KEY = "COGNIRUNNER_MEMORY_EPOCH";
const STAMP = Date.now().toString(36);
const OUT = new URL("../results/coder-pin-epoch", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

/* F-699 — requireEnvAck already refused if the environment has no web-trigger URL, and it
   names the variable to set; only the two credentials are left to check here. */
if (!SECRET || !ACCT) { console.error("need HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID"); process.exit(2); }

let failures = 0;
const evidence = { issue: ISSUE, stamp: STAMP, checks: [], measurements: {} };
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

// The pin key is built the way src/coder-engine.js builds it (safeKeyPart: a conservative
// slug). Both parts here are already [A-Za-z0-9_-], so the slug is the identity.
const pinKey = (issueKey, threadId) => `coder_pin:${issueKey}:${threadId}`;

const THREAD = `t_f578_${STAMP}`;
const MARKER = `F578PROBE-${STAMP.toUpperCase()}`;
const probeMemoryIds = [];
let providerBefore = null;

const runTurn = async (label, message) => {
  const r = await call("startCoderTurn", { issueKey: ISSUE, threadId: THREAD, message });
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
  const usage = (inner && inner.usage) || {};
  const out = { label, taskId: r.taskId, logs, usage, knowledge: inner && inner.knowledge };
  note(`${label}: usage`, { cacheReadTokens: usage.cacheReadTokens, firstRoundCacheReadTokens: usage.firstRoundCacheReadTokens, tokens: usage.tokens, rounds: inner && inner.rounds });
  return out;
};

const main = async () => {
  // ── record + flip the provider ───────────────────────────────────────────────
  providerBefore = await kvGet(PROVIDER_SLOT);
  console.log(`recorded ${PROVIDER_SLOT} before the flip: ${mask(providerBefore)}`);
  evidence.providerBeforeMasked = mask(providerBefore);
  const capBefore = await call("getAgentCapability");
  note("capability before the flip", { enabled: capBefore.enabled, reason: capBefore.reason, edition: capBefore.edition, agentModel: capBefore.agentModel });
  const set = await kvSet(PROVIDER_SLOT, "managed");
  check("the provider slot was switched to the managed engine", set.status === 200 && set.body && set.body.now === "managed", { now: set.body && set.body.now });
  console.log("waiting 40s for the ~30s provider cache…");
  await sleep(40000);
  const cap = await call("getAgentCapability");
  check('the Coder is ENABLED on the managed engine (reason "managed")', cap.enabled === true && cap.reason === "managed",
    { enabled: cap.enabled, reason: cap.reason, edition: cap.edition });
  if (cap.enabled !== true) throw new Error(`the Coder is not enabled (${cap.reason}) — the rest of this script would prove nothing`);

  // ── the memory that must reach the pinned prefix ─────────────────────────────
  const epoch0 = await kvGet(EPOCH_KEY);
  const add1 = await call("addMemory", { content: `${MARKER}: this instance's probe marker line, added by the F-578 live driver before turn 1.`, source: "user" });
  check("the probe memory was added (global scope, source user)", add1.success === true && !!add1.id, { id: add1.id, error: add1.error });
  if (add1 && add1.id) probeMemoryIds.push(add1.id);
  const epochAfterAdd = await kvGet(EPOCH_KEY);
  check("an ADD does not bump the memory epoch (F-578's stated rule)", String(epochAfterAdd ?? 0) === String(epoch0 ?? 0), { before: epoch0, after: epochAfterAdd });

  // ── turns 1 and 2: the pin is created, then replayed ─────────────────────────
  const t1 = await runTurn("turn1", "In two sentences, what is this issue about?");
  const pinAfter1 = await kvGet(pinKey(ISSUE, THREAD));
  check("turn 1 created the pin row", !!pinAfter1 && typeof pinAfter1 === "object", { present: !!pinAfter1 });
  const t2 = await runTurn("turn2", "Add one more sentence about the risk.");
  const pin2 = await kvGet(pinKey(ISSUE, THREAD));
  evidence.pinAfterTurn2 = pin2 && { memoryEpoch: pin2.memoryEpoch, skillEpoch: pin2.skillEpoch, skillIds: pin2.skillIds, memoryCount: pin2.memoryCount, at: pin2.at, memoryBlockBytes: pin2.memoryBlock ? Buffer.byteLength(pin2.memoryBlock) : 0 };
  check("the pin row carries a memoryEpoch stamp", !!pin2 && pin2.memoryEpoch !== undefined, { memoryEpoch: pin2 && pin2.memoryEpoch });
  check("the pin row carries a skillIds list (the F-578 stamp's other half)", !!pin2 && Array.isArray(pin2.skillIds), { skillIds: pin2 && pin2.skillIds, skillEpoch: pin2 && pin2.skillEpoch });
  const inPrefixBefore = !!(pin2 && pin2.memoryBlock && String(pin2.memoryBlock).includes(MARKER));
  check("THE POSITIVE CONTROL: the probe memory's line IS inside the pinned prefix before the delete", inPrefixBefore,
    { marker: MARKER, memoryCount: pin2 && pin2.memoryCount });
  const replayed = (t2 && t2.logs || []).some((l) => /knowledge changed since it was pinned/i.test(l));
  check("turn 2 REPLAYED the pin (no invalidation line)", !replayed, { line: (t2 && t2.logs || []).find((l) => /pinned/i.test(l)) || null });

  // ── the delete, the epoch, and the turn that must notice ─────────────────────
  const epochBeforeDelete = await kvGet(EPOCH_KEY);
  const del = await call("deleteMemory", { id: probeMemoryIds[0] });
  check("the probe memory was deleted", del.success === true, { error: del.error });
  if (del.success === true) probeMemoryIds.length = 0;
  const epochAfterDelete = await kvGet(EPOCH_KEY);
  check("the DELETE bumped the memory epoch by exactly 1",
    Number(epochAfterDelete ?? 0) === Number(epochBeforeDelete ?? 0) + 1, { before: epochBeforeDelete, after: epochAfterDelete });
  const expectLine = `memoryEpoch ${Number(pin2 && pin2.memoryEpoch || 0)}→${Number(epochAfterDelete ?? 0)}`;
  evidence.expectedVerdict = expectLine;

  const t3 = await runTurn("turn3", "One more sentence, please.");
  const line3 = (t3 && t3.logs || []).find((l) => /knowledge changed since it was pinned/i.test(l)) || null;
  check("turn 3's execution log names the invalidation", !!line3, { line: line3 });
  check(`turn 3's invalidation names the epoch move (${expectLine})`, !!line3 && line3.includes(expectLine), { line: line3, expected: expectLine });
  const pin3 = await kvGet(pinKey(ISSUE, THREAD));
  evidence.pinAfterTurn3 = pin3 && { memoryEpoch: pin3.memoryEpoch, skillIds: pin3.skillIds, memoryCount: pin3.memoryCount, at: pin3.at };
  check("the pin row was REWRITTEN with the new epoch",
    !!pin3 && String(pin3.memoryEpoch) === String(epochAfterDelete ?? 0), { was: pin2 && pin2.memoryEpoch, now: pin3 && pin3.memoryEpoch });
  check("the deleted memory's line is ABSENT from the rewritten prefix (the same read that saw it above)",
    !!pin3 && !(String(pin3.memoryBlock || "").includes(MARKER)), { marker: MARKER, stillThere: !!(pin3 && String(pin3.memoryBlock || "").includes(MARKER)) });

  const t4 = await runTurn("turn4", "And a final sentence.");
  const c2 = Number((t2 && t2.usage && (t2.usage.firstRoundCacheReadTokens ?? t2.usage.cacheReadTokens)) || 0);
  const c3 = Number((t3 && t3.usage && (t3.usage.firstRoundCacheReadTokens ?? t3.usage.cacheReadTokens)) || 0);
  const c4 = Number((t4 && t4.usage && (t4.usage.firstRoundCacheReadTokens ?? t4.usage.cacheReadTokens)) || 0);
  note("first-round cache reads across turns 2/3/4", { turn2: c2, turn3: c3, turn4: c4 });
  check("the moved prefix shows up as a cache-read DROP on turn 3 and a recovery on turn 4", c3 < c2 && c4 > c3,
    { turn2: c2, turn3: c3, turn4: c4 });

  // ── F-598 control: an add in ANOTHER project's scope ─────────────────────────
  const epochBeforeAdd2 = await kvGet(EPOCH_KEY);
  const add2 = await call("addMemory", { content: `${MARKER}-OTHERSCOPE: a probe marker scoped to ${OTHER_PROJECT}, which this thread's issue is not in.`, source: "user", projectKey: OTHER_PROJECT });
  check("the other-project probe memory was added", add2.success === true && !!add2.id, { id: add2.id, error: add2.error, projectKey: OTHER_PROJECT });
  if (add2 && add2.id) probeMemoryIds.push(add2.id);
  const epochAfterAdd2 = await kvGet(EPOCH_KEY);
  check("the scoped ADD did not bump the epoch", String(epochAfterAdd2 ?? 0) === String(epochBeforeAdd2 ?? 0), { before: epochBeforeAdd2, after: epochAfterAdd2 });
  const t5 = await runTurn("turn5", "Summarise what you have said so far in one line.");
  const line5 = (t5 && t5.logs || []).find((l) => /knowledge changed since it was pinned/i.test(l)) || null;
  check("turn 5 did NOT invalidate the pin after an out-of-scope add (F-598 is not deployed — recorded as the CURRENT behaviour)", !line5, { line: line5 });
  const pin5 = await kvGet(pinKey(ISSUE, THREAD));
  check("the out-of-scope memory never reached this thread's prefix or its extra block",
    !!pin5 && !String(pin5.memoryBlock || "").includes("OTHERSCOPE"), { inPrefix: !!(pin5 && String(pin5.memoryBlock || "").includes("OTHERSCOPE")) });
  note("F-598 current behaviour", {
    verdict: line5 ? "an out-of-scope add DID invalidate" : "an out-of-scope add did not invalidate and did not enter the block",
    epochMoved: String(epochAfterAdd2 ?? 0) !== String(epochBeforeAdd2 ?? 0),
  });
  evidence.threadId = THREAD;
};

try { await main(); } catch (e) { console.error("THREW", e.stack); failures += 1; }
finally {
  // 1. every probe memory goes, on every path.
  try {
    if (probeMemoryIds.length) {
      const d = await call("deleteMemory", { ids: probeMemoryIds });
      check("cleanup: the remaining probe memories were deleted", d.success === true, { ids: probeMemoryIds, error: d.error });
    } else {
      check("cleanup: no probe memory left behind", true, {});
    }
    const left = ((await call("getMemories")).memories || []).filter((m) => String(m.content || "").includes(MARKER));
    check("cleanup: a second read of the store finds no probe memory", left.length === 0, { left: left.map((m) => m.id) });
  } catch (e) { console.error("MEMORY CLEANUP FAILED", e.message); failures += 1; }
  // 2. the provider slot goes back to exactly what it was — value never printed.
  try {
    let r = null;
    for (let i = 0; i < 4; i++) {
      r = await kvSet(PROVIDER_SLOT, providerBefore).catch((e) => ({ status: 0, body: { error: e.message } }));
      if (r.status === 200 && String(r.body && r.body.now) === String(providerBefore)) break;
      console.log(`        (restore attempt ${i + 1}/4 did not confirm)`);
      await sleep(3000 * (i + 1));
    }
    check("the provider slot was restored to its recorded value", r.status === 200 && String(r.body && r.body.now) === String(providerBefore), { nowMasked: mask(r.body && r.body.now) });
  } catch (e) { console.error("PROVIDER RESTORE FAILED", e.message); failures += 1; }
  fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(evidence, null, 2));
  console.log(`\n${failures} failure(s). Evidence: ${OUT}/evidence.json`);
  process.exit(failures ? 1 : 0);
}
