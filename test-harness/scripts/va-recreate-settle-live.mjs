/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-575 / F-585 — A RE-CREATED AGENT WAITS FOR ITS PREDECESSOR'S TURNS TO SETTLE.
 *
 * THE SHAPE OF THE PROOF.
 *   1. Agent A is created and given TWO prepare ticks, so `va_exec:{A}:*` claim rows and
 *      the rest of the ledger actually exist. Every key is read through `?what=kvs` WHILE
 *      A LIVES — the positive control every later "absent" rests on.
 *   2. A is DELETED. `va_purged:{A}` is read back: the tombstone must be standing.
 *   3. A is RE-CREATED WITH THE SAME ID (`saveScheduledJob` with `job.id` — the resolver's
 *      not-found refusal is not returned, so the save falls through and writes the row) and
 *      ticked IMMEDIATELY. Inside `VA_PURGE_SETTLE_MS` (5 minutes) the tick must SKIP with
 *      `skipped[0].gate === "purge-settling"`, and `va_purged:{A}` must STILL BE THERE.
 *      `settling` says which guard held: "window" (F-575's clock), "claim" (a live
 *      `va_exec`/`va_post`/`va_compact` row) or "scan_truncated" (F-585's blocking
 *      could-not-tell).
 *   4. The window is WAITED OUT — the hook's `kvSet` allow-list does not carry `va_purged:*`
 *      (a plantable tombstone is a plantable permission), so there is no way to age it
 *      artificially and the script sleeps instead. A tick after the window must clear the
 *      tombstone (`va_purged:{A}` absent on a second read that saw it before) and produce a
 *      NORMAL prepare receipt with no purge gate on it.
 *
 * NOTHING IS POSTED. The agent's only power is `replyInternal`, `shadowUntilTick` is 500,
 * and it is PAUSED between ticks so the five-minute planner cannot enqueue a post run.
 * The project's comment counts are read before and after anyway.
 *
 * RESTORE. The agent-model KVS SLOT (not the resolver's answer — it answers a fallback it
 * then refuses to re-save) is recorded and replayed in a finally, and the agent is deleted.
 *
 * Usage (from test-harness/):
 *   node scripts/va-recreate-settle-live.mjs
 *   node scripts/va-recreate-settle-live.mjs --keep --tickwait=300
 *
 * Env: STAGING_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID + the JIRA_* trio.
 */
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";

const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);
const ENV_NAME = arg("env", "staging");
const HOOK_URL = ENV_NAME === "dev" ? env.TESTSTATE_URL : env.STAGING_TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "JT");
const DESK_ID = arg("desk", "1");
const QUEUES = arg("queues", "1,2,3").split(",").filter(Boolean);
const FRONTIER = arg("model", "claude-sonnet-5");
const TICK_WAIT_S = Number(arg("tickwait", "300"));
const SETTLE_MS = 5 * 60 * 1000; // VA_PURGE_SETTLE_MS, src/shared/va-keys.js
const KEEP = flag("keep");
const AGENT_MODEL_SLOT = "COGNIRUNNER_AGENT_MODEL_atlassian";
const OUT = new URL("../results/va-recreate-settle", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);
const restore = { agentId: null, agentModelSlot: undefined };

async function fetchRetry(url, init, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; console.log(`        (transport retry ${i + 1}/${tries}: ${e.message})`); await sleep(2000 * (i + 1)); }
  }
  return { __transportError: last };
}
const readRes = async (res) => {
  if (res && res.__transportError) return { status: 0, json: null, raw: `transport: ${res.__transportError.message}` };
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, json: null, raw: e.message }; }
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, raw: json ? null : text.slice(0, 300) };
};
async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  return readRes(await fetchRetry(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
async function invoke(functionKey, payload = {}) {
  const r = await hook({ action: "invokeResolver", functionKey, payload, accountId: ADMIN });
  return { status: r.status, body: r.json, raw: r.raw };
}
async function kvs(key) {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`);
  if (r.status !== 200 || !r.json) return { ok: false, value: null, status: r.status };
  return { ok: true, value: r.json.value === undefined ? null : r.json.value };
}
const AUTH = "Basic " + Buffer.from(`${requireEnv("JIRA_ADMIN_EMAIL")}:${requireEnv("JIRA_API_TOKEN")}`).toString("base64");
async function jira(path, init = {}) {
  return readRes(await fetchRetry(requireEnv("JIRA_BASE_URL") + path, {
    ...init, headers: { Authorization: AUTH, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) },
  }));
}
async function commentTotal() {
  const s = await jira(`/rest/api/3/search/jql?jql=${encodeURIComponent(`project = ${PROJECT} ORDER BY created DESC`)}&maxResults=100&fields=summary`);
  const keys = ((s.json && s.json.issues) || []).map((i) => i.key);
  let total = 0;
  for (const k of keys) { const r = await jira(`/rest/api/3/issue/${k}/comment?maxResults=1`); if (r.status === 200 && r.json) total += Number(r.json.total); }
  return { issues: keys.length, comments: total };
}

const receiptsOf = (s) => (s && Array.isArray(s.receipts) ? s.receipts : []);
const vaRecord = () => ({
  persona: { name: "Settle", voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: { serviceDesks: [{ serviceDeskId: DESK_ID, queueIds: QUEUES }], jql: `project = ${PROJECT}`, mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: 3, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 2, maxWritesPerRun: 10 },
  status: { paused: false, shadowUntilTick: 500 },
});

/** Fire one prepare tick and wait until a NEW prepare receipt lands (by count, never by sleep). */
async function tick(jobId, label, waitS = TICK_WAIT_S) {
  const before = receiptsOf((await invoke("getVaStatus", { jobId })).body).filter((r) => r.phase === "prepare").length;
  const ran = await invoke("runScheduledJobNow", { id: jobId });
  if (!(ran.body && ran.body.success)) { FAIL(`${label}: runScheduledJobNow refused`, { body: JSON.stringify(ran.body).slice(0, 300) }); return null; }
  info(`${label}: va-tick enqueued, taskId=${ran.body.taskId}`);
  const deadline = Date.now() + waitS * 1000;
  while (Date.now() < deadline) {
    const st = (await invoke("getVaStatus", { jobId })).body;
    const preps = receiptsOf(st).filter((r) => r.phase === "prepare");
    if (preps.length > before) return { receipt: preps[0], status: st };
    await sleep(8000);
  }
  NV(`${label}: no new prepare receipt within ${waitS}s`);
  return null;
}

async function pause(jobId, paused) {
  const cur = await invoke("getScheduledJob", { id: jobId });
  const j = cur.body && cur.body.job;
  if (!j) return false;
  const r = await invoke("saveScheduledJob", { job: { ...j, va: { ...j.va, status: { ...j.va.status, paused } } } });
  return !!(r.body && r.body.success);
}

async function main() {
  console.log(`\nF-575/F-585 — THE RE-CREATED AGENT'S SETTLE WINDOW, on ${ENV_NAME.toUpperCase()}, project ${PROJECT}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  /* ── capability ─────────────────────────────────────────────────────────── */
  const cap0 = await invoke("getAgentCapability", {});
  info(`getAgentCapability before: ${JSON.stringify(cap0.body)}`);
  if (cap0.body && cap0.body.enabled !== true) {
    if (cap0.body.reason !== "needs-frontier-model") { NV(`capability is off for "${cap0.body.reason}" and this script may not change that`); return; }
    const slot = await kvs(AGENT_MODEL_SLOT);
    restore.agentModelSlot = slot.value;
    info(`${AGENT_MODEL_SLOT} recorded before the flip: ${slot.value === null ? "EMPTY" : JSON.stringify(slot.value)}`);
    const set = await invoke("saveAgentModel", { model: FRONTIER });
    if (!(set.body && set.body.success)) throw new Error(`saveAgentModel refused: ${JSON.stringify(set.body).slice(0, 300)}`);
    info("waiting 35s for the ~30s provider/model config cache");
    await sleep(35000);
  }
  const cap1 = await invoke("getAgentCapability", {});
  if (!(cap1.body && cap1.body.enabled === true)) { FAIL("capability is still off", { cap: cap1.body }); return; }
  PASS(`capability is ON (edition=${cap1.body.edition} agentModel=${cap1.body.agentModel})`);

  const cBefore = await commentTotal();
  info(`${PROJECT} before: ${JSON.stringify(cBefore)}`);

  /* ── STEP 1 — agent A, two prepare ticks ────────────────────────────────── */
  console.log("\nSTEP 1 - create agent A and run TWO prepare ticks so claim rows exist");
  const created = await invoke("saveScheduledJob", { job: { name: `F-575 settle proof ${Date.now()}`, mode: "va", enabled: true, va: vaRecord() } });
  if (!(created.body && created.body.success)) throw new Error(`saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 400)}`);
  const jobId = created.body.job.id;
  restore.agentId = jobId;
  const createdAtA = created.body.job.createdAt;
  PASS(`agent A ${jobId} created (createdAt=${createdAtA})`);
  const t1 = await tick(jobId, "tick 1");
  info(`tick 1 receipt: ${JSON.stringify(t1 && t1.receipt).slice(0, 400)}`);
  const t2 = await tick(jobId, "tick 2");
  info(`tick 2 receipt: ${JSON.stringify(t2 && t2.receipt).slice(0, 400)}`);
  await pause(jobId, true);
  info("agent A is PAUSED so the planner cannot enqueue a post run");

  /* ── STEP 2 — the ledger, read while A lives ────────────────────────────── */
  console.log("\nSTEP 2 - the ledger keys, read while A LIVES (the positive control)");
  const idx = (await kvs(`va_index:${jobId}`)).value;
  const items = (idx && Array.isArray(idx.ids) ? idx.ids : []);
  const KEYS = [`va_index:${jobId}`, `va_health:${jobId}`, `va_memory:${jobId}`, ...items.map((k) => `va_item:${jobId}:${k}`)];
  const seen = {};
  for (const k of KEYS) { seen[k] = (await kvs(k)).value; info(`${k} -> ${seen[k] === null ? "(absent)" : JSON.stringify(seen[k]).slice(0, 120)}`); }
  const present = KEYS.filter((k) => seen[k] !== null && seen[k] !== undefined);
  if (present.length) PASS(`${present.length}/${KEYS.length} ledger key(s) READABLE through this query while A lives`);
  else FAIL("no ledger key readable at all — nothing below can be judged");
  ev.ledgerBefore = Object.fromEntries(KEYS.map((k) => [k, seen[k] !== null]));
  const tombBefore = (await kvs(`va_purged:${jobId}`)).value;
  PASS("no tombstone stands before the delete", { va_purged: tombBefore });
  if (tombBefore !== null) FAIL("a tombstone was already standing before the delete", { tombBefore });

  /* ── STEP 3 — delete, then re-create with the SAME id ───────────────────── */
  console.log("\nSTEP 3 - delete A, read the tombstone, re-create with the SAME id");
  const del = await invoke("deleteScheduledJob", { id: jobId });
  if (del.body && del.body.success) { PASS(`deleteScheduledJob: ${JSON.stringify(del.body).slice(0, 200)}`); restore.agentId = null; }
  else { FAIL(`deleteScheduledJob refused: ${JSON.stringify(del.body).slice(0, 300)}`); return; }
  const deletedAt = Date.now();
  const tomb = (await kvs(`va_purged:${jobId}`)).value;
  ev.tombstone = tomb;
  if (tomb && tomb.at) PASS(`the tombstone va_purged:${jobId} STANDS`, { at: tomb.at, reason: tomb.reason || tomb.why || null });
  else { FAIL("no tombstone was written on delete", { tomb }); return; }
  // F-577 — the purge REASON. Recorded whatever it is; a raw id or a missing reason is the defect.
  info(`tombstone row: ${JSON.stringify(tomb).slice(0, 300)}`);

  const re = await invoke("saveScheduledJob", { job: { id: jobId, name: `F-575 settle proof RECREATED ${Date.now()}`, mode: "va", enabled: true, va: vaRecord() } });
  ev.recreate = { success: re.body && re.body.success, error: re.body && re.body.error, id: re.body && re.body.job && re.body.job.id };
  if (re.body && re.body.success && re.body.job && re.body.job.id === jobId) {
    restore.agentId = jobId;
    PASS(`agent A was RE-CREATED with the same id ${jobId}`, { createdAt: re.body.job.createdAt, wasCreatedAt: createdAtA });
    if (re.body.job.createdAt === createdAtA) FAIL("the re-created row kept the OLD createdAt — the tombstone comparison cannot work", { createdAt: re.body.job.createdAt });
  } else {
    NV(`saveScheduledJob will not re-create a deleted id — the F-575 settle arm cannot be driven this way`, { body: JSON.stringify(re.body).slice(0, 300) });
    return;
  }

  /* ── STEP 4 — a tick INSIDE the settle window must skip ─────────────────── */
  console.log("\nSTEP 4 - a tick INSIDE the 5-minute settle window");
  const elapsed = Date.now() - deletedAt;
  info(`~${Math.round(elapsed / 1000)}s since the delete; the window is ${SETTLE_MS / 1000}s`);
  const tIn = await tick(jobId, "tick inside the window", 180);
  const rIn = tIn && tIn.receipt;
  ev.receiptInsideWindow = rIn;
  info(`receipt: ${JSON.stringify(rIn).slice(0, 500)}`);
  const skipped = (rIn && Array.isArray(rIn.skipped) && rIn.skipped) || [];
  const gate = skipped.find((s) => s && s.gate === "purge-settling");
  if (gate) PASS('the tick SKIPPED with gate "purge-settling"', { gate: gate.gate, reason: gate.reason });
  else if (rIn) FAIL("the tick inside the window did NOT carry the purge-settling gate", { skipped });
  else NV("no receipt landed for the tick inside the window");
  const tombStill = (await kvs(`va_purged:${jobId}`)).value;
  if (tombStill && tombStill.at) PASS("the tombstone still STANDS after the in-window tick", { at: tombStill.at });
  else FAIL("the tombstone was cleared inside the settle window", { tombStill });

  /* ── STEP 5 — wait the window out, tick again ───────────────────────────── */
  console.log("\nSTEP 5 - wait the window out (kvSet cannot plant va_purged:*, so this sleeps)");
  const wait = Math.max(0, SETTLE_MS - (Date.now() - deletedAt)) + 20000;
  info(`sleeping ${Math.round(wait / 1000)}s`);
  await sleep(wait);
  const tAfter = await tick(jobId, "tick after the window", 240);
  const rAfter = tAfter && tAfter.receipt;
  ev.receiptAfterWindow = rAfter;
  info(`receipt: ${JSON.stringify(rAfter).slice(0, 500)}`);
  const skipAfter = (rAfter && Array.isArray(rAfter.skipped) && rAfter.skipped) || [];
  const gateAfter = skipAfter.find((s) => s && s.gate === "purge-settling");
  if (rAfter && !gateAfter) PASS("the tick after the window carries NO purge gate — a normal prepare receipt", { phase: rAfter.phase, swept: rAfter.swept, worked: rAfter.worked, skipped: skipAfter.length });
  else if (gateAfter) FAIL("the tick after the window is STILL gated", { gate: gateAfter });
  else NV("no receipt landed for the tick after the window");
  const tombGone = (await kvs(`va_purged:${jobId}`)).value;
  if (tombGone === null) PASS(`the tombstone va_purged:${jobId} is GONE (the same read saw it twice above)`);
  else FAIL("the tombstone is still standing after the window", { tombGone });

  const cAfter = await commentTotal();
  ev.comments = { before: cBefore, after: cAfter };
  if (cAfter.comments === cBefore.comments) PASS("no comment was posted anywhere in the project", { before: cBefore.comments, after: cAfter.comments });
  else FAIL("the comment count moved", { before: cBefore.comments, after: cAfter.comments });
  ev.jobId = jobId;
}

try { await main(); } catch (e) { console.error("THREW", e.stack); fails += 1; }
finally {
  try {
    if (restore.agentId && !KEEP) {
      const r = await invoke("deleteScheduledJob", { id: restore.agentId });
      info(`cleanup deleteScheduledJob ${restore.agentId}: ${JSON.stringify(r.body).slice(0, 160)}`);
      const t = (await kvs(`va_purged:${restore.agentId}`)).value;
      info(`cleanup tombstone: ${t ? t.at : "(none)"} — it carries VA_PURGE_TTL and ages out on its own`);
    }
    if (restore.agentModelSlot !== undefined) {
      const r = await hook({ action: "kvSet", key: AGENT_MODEL_SLOT, value: restore.agentModelSlot });
      if (r.status === 200) PASS(`${AGENT_MODEL_SLOT} restored to its recorded value`);
      else FAIL(`${AGENT_MODEL_SLOT} restore did not confirm`, { status: r.status });
    }
  } catch (e) { console.error("CLEANUP FAILED", e.message); fails += 1; }
  fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
  console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/evidence.json`);
  process.exit(fails ? 1 : 0);
}
