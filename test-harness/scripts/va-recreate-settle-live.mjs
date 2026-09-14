/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-575 / F-585 — A RE-CREATED AGENT WAITS FOR ITS PREDECESSOR'S TURNS TO SETTLE.
 *
 * HOW THIS DRIVER CHANGED, AND WHY (F-616). The first version drove the window by
 * DELETING an agent and RE-CREATING it under the same id through `saveScheduledJob`.
 * That only worked because a save carrying an unknown id CREATED the row at that id —
 * which is the defect F-616 closed: a create must never accept a client-chosen id, and
 * an id is a namespace (the whole `va_*` ledger and the `va_purged:` tombstone hang off
 * it). With that door shut there is no product path to a re-created agent, so the
 * window is driven through a DEV-ONLY test-hook action instead — `action:"vaTombstone"`,
 * behind the same HARNESS_SECRET Bearer as the rest of src/test-hook.js and absent in
 * production. Planting a tombstone GRANTS nothing: every writer that reads one refuses
 * under it. The product path being closed is itself asserted below, first.
 *
 * THE SHAPE OF THE PROOF.
 *   0. `saveScheduledJob` REFUSES a job id that names no row (F-616), and the deleted
 *      agent's id cannot be re-taken. This is the reason the rest of the script is
 *      shaped the way it is, so it is measured and not assumed.
 *   1. Agent A is created and TICKED, so `va_exec:{A}:*` claim rows and the rest of the
 *      ledger actually exist; every key is read through `?what=kvs` WHILE A LIVES — the
 *      positive control every later "absent" rests on. Then A is PAUSED.
 *   2. A tombstone is PLANTED for A. The hook clamps `at` to just before the job's
 *      `createdAt`, because `clearPurgeTombstone` only weighs a tombstone that predates
 *      the job (that comparison is what tells a re-created job from a tick of the
 *      deleted one) — an unclamped plant would land on `tombstone_newer_than_job` and
 *      prove a different branch. The answer reports the clamp, and it is asserted.
 *   3. A tick INSIDE the window must do NO WORK: no new prepare receipt, and the
 *      tombstone must still stand. That the tick RAN AT ALL is proved separately —
 *      "nothing happened" and "the consumer never woke up" must never be the same
 *      evidence. (The purge-settling arm of `runPrepareTick` returns before `recordTick`,
 *      so a SKIPPED tick deliberately leaves no receipt; that is the observable, not a bug
 *      in this script.) F-797 — the liveness proof is the `async_job:{taskId}` row, NOT
 *      the execution log: `va-tick` is not a `listener`/`scheduledjob` task, so no
 *      execution-log entry is written for it and the old probe could only ever answer
 *      "no evidence" for the very arm it exists to measure. See `tick()`.
 *   4. Tick 1's fan-out claim is WAITED OUT first (`va_running:{agent}`, F-797: it is the
 *      THIRD condition `clearPurgeTombstone` weighs, and aging the tombstone satisfies
 *      only the second), the tombstone is AGED past `VA_PURGE_SETTLE_MS` through the same
 *      door, and the next tick must clear it and produce a NORMAL prepare receipt with no
 *      purge gate. A clear that cannot be attributed to the settle window is N/V, never a
 *      FAIL: the run did not measure what it set out to measure.
 *
 * NOTHING IS POSTED. The agent's only power is `replyInternal`, `shadowUntilTick` is
 * 500, and it is PAUSED for every tick after the first, so the five-minute planner
 * cannot enqueue a post run. The project's comment counts are read before and after
 * anyway.
 *
 * RESTORE. The agent-model KVS SLOT (not the resolver's answer — it answers a fallback
 * it then refuses to re-save) is recorded and replayed in a finally, the planted
 * tombstone is cleared through the hook, and the agent is deleted.
 *
 * Usage (from test-harness/):
 *   node scripts/va-recreate-settle-live.mjs
 *   node scripts/va-recreate-settle-live.mjs --keep --tickwait=300
 *
 * Env: STAGING_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID + the JIRA_* trio.
 */
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
/* F-776 - the flip decision and the capability verdict have ONE home; see the lib for why a
   capability that is off is N/V and not a FAIL. `--no-flip-model` is the explicit opt-out. */
/* F-782 — `decideInstanceFlip` is imported for the SECOND half of the decision: which capability
   reasons this run may fix at all. The `needs-frontier-model` comparison below used to be spelled
   here, which is the same second-home defect F-776 closed for the flag and the verdict. */
import { resolveFlipModel, judgeAgentCapability, applyVerdict, decideInstanceFlip } from "../lib/agent-capability-precondition.mjs";
/* F-787 - the commit this run came from, recorded in the evidence file it writes. */
import { runProvenance, formatResultLine, resultExitCode } from "../lib/driver-report.mjs";

/* F-796 - THE RUN'S OWN THROW, CARRIED INTO THE RESULT LINE. A summary printed from a
   catch or a finally prints the counters the throw FROZE; `formatResultLine({crashed})`
   is what makes the FIRST WORD of that line say so, which is the only part a grep takes. */
let crashed = null;

const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["agents", "jobs", "providerSlot"], defaultEnv: "staging" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "JT");
const DESK_ID = arg("desk", "1");
const QUEUES = arg("queues", "1,2,3").split(",").filter(Boolean);
const FRONTIER = arg("model", "claude-sonnet-5");
const TICK_WAIT_S = Number(arg("tickwait", "300"));
const SETTLE_MS = 5 * 60 * 1000; // VA_PURGE_SETTLE_MS, src/shared/va-keys.js
const KEEP = flag("keep");
const { flipModel: FLIP_MODEL, reason: FLIP_MODEL_REASON } = resolveFlipModel({ envName: ENV_NAME, argv: process.argv.slice(2) });
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
const restore = { agentId: null, agentModelSlot: undefined, tombstoneFor: null };

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
/** The F-616 door: plant | age | read | clear a `va_purged:{agent}` tombstone. */
async function tombstone(op, agent, extra = {}) {
  const r = await hook({ action: "vaTombstone", op, agent, ...extra });
  return { status: r.status, body: r.json, raw: r.raw };
}
/** Execution logs for one rule — the proof that a tick RAN, independent of its receipt. */
async function execLogCount(jobId) {
  const r = await hook(null, "GET", `?what=execlogs&ruleId=${encodeURIComponent(jobId)}`);
  const logs = (r.json && Array.isArray(r.json.logs)) ? r.json.logs : null;
  return logs ? logs.length : null;
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
const prepareCount = async (jobId) => receiptsOf((await invoke("getVaStatus", { jobId })).body).filter((r) => r.phase === "prepare").length;
const vaRecord = () => ({
  persona: { name: "Settle", voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: { serviceDesks: [{ serviceDeskId: DESK_ID, queueIds: QUEUES }], jql: `project = ${PROJECT}`, mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: 3, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 2, maxWritesPerRun: 10 },
  status: { paused: false, shadowUntilTick: 500 },
});

/*
 * Fire one prepare tick and wait for EVIDENCE THAT IT RAN. Telling a SKIPPED tick apart
 * from a consumer that never woke up is the whole job of this helper, and it had two
 * sources for that where the arm under test touches NEITHER.
 *
 * F-797 — THE LIVENESS PROBE WAS BLIND TO THE ARM IT MEASURES.
 *
 * A `purge-settling` tick is RECEIPT-FREE BY DESIGN (F-575/F-614: the receipt is a ledger
 * write and a standing tombstone is exactly what refuses ledger writes — see the arm in
 * src/virtual-admin.js, which returns before `recordTick`, before `recordTickHealth` and
 * before any claim take). It writes NOTHING under the tombstone. So:
 *   · a new PREPARE RECEIPT never appears — that is the observable, not a failure;
 *   · the EXECUTION LOG does not grow either: `va-tick` is not `listener`/`scheduledjob`,
 *     and the consumer only writes an execution-log entry for those two types;
 *   · the reason reaches `deps.log(...)`, i.e. `forge logs`, which no driver can read.
 * On a flag-less staging run that produced 14/1/2 — an N/V liveness followed by a FAIL on
 * the tombstone, with the product behaving exactly as specified.
 *
 * THE THIRD SOURCE, AND WHY IT IS THE RIGHT ONE. Every queued task, polled or not, has an
 * `async_job:{taskId}` row: the consumer sets `status:"running"` with `startedAt` the
 * moment it picks the task up and `status:"done"` with `finishedAt` and `durationMs` when
 * the handler returns (src/async-handler.js — `updateAsyncJob` on both sides of the
 * `UNPOLLED_TASKS` branch, because it is OPERATIONAL metadata, not a poll result). It is
 * outside the ledger, so the tombstone does not refuse it, and it is written for the
 * refused tick precisely because the refusal is a normal return. `runScheduledJobNow`
 * hands back the `taskId`, so the driver can read the row it already has the key for.
 *
 * The three are reported side by side and the strongest available one decides: a receipt
 * says the tick DID WORK, an execution log or a finished async job says it RAN. Nothing at
 * all still means N/V, and now it means the consumer really did not wake up.
 */
async function tick(jobId, label, waitS = TICK_WAIT_S) {
  const receiptsBefore = await prepareCount(jobId);
  const logsBefore = await execLogCount(jobId);
  const ran = await invoke("runScheduledJobNow", { id: jobId });
  if (!(ran.body && ran.body.success)) { FAIL(`${label}: runScheduledJobNow refused`, { body: JSON.stringify(ran.body).slice(0, 300) }); return null; }
  const taskId = ran.body.taskId || null;
  info(`${label}: va-tick enqueued, taskId=${taskId}`);
  const deadline = Date.now() + waitS * 1000;
  let logsAfter = logsBefore;
  let asyncJob = null;
  while (Date.now() < deadline) {
    const st = (await invoke("getVaStatus", { jobId })).body;
    const preps = receiptsOf(st).filter((r) => r.phase === "prepare");
    logsAfter = await execLogCount(jobId);
    const grew = logsBefore != null && logsAfter != null && logsAfter > logsBefore;
    // The consumer's own row for THIS task. `status` is the only field graded; the rest
    // rides into the evidence file so a later reader can see how long the tick took.
    asyncJob = taskId ? (await kvs(`async_job:${taskId}`)).value : null;
    const finished = !!(asyncJob && (asyncJob.status === "done" || asyncJob.status === "error"));
    const base = { status: st, logsBefore, logsAfter, taskId, asyncJob, liveness: null };
    if (preps.length > receiptsBefore) return { ...base, receipt: preps[0], newReceipt: true, ranAtAll: true, liveness: "prepare-receipt" };
    // No receipt, but the run is recorded: that IS the skip, and we stop waiting for it.
    if (grew) return { ...base, receipt: null, newReceipt: false, ranAtAll: true, liveness: "execution-log" };
    if (finished) return { ...base, receipt: null, newReceipt: false, ranAtAll: true, liveness: `async_job:${asyncJob.status}` };
    await sleep(8000);
  }
  return { receipt: null, status: null, newReceipt: false, ranAtAll: false, logsBefore, logsAfter, taskId, asyncJob, liveness: null };
}

/*
 * F-797 — WAIT OUT THE CLAIM TICK 1 LEFT BEHIND, BEFORE ASKING FOR A CLEAR.
 *
 * `clearPurgeTombstone` has THREE conditions, and aging the tombstone only satisfies the
 * second. The third is the claim check: `va_running:{agent}` carries `newestTakeAt`, and
 * `liveTakeFor` calls the agent LIVE while that stamp is inside the SAME window the
 * tombstone is measured against (VA_PURGE_SETTLE_MS). STEP 1 of this script ticks the
 * agent normally, and every winning claim take in that fan-out stamps the marker — so the
 * after-window tick used to arrive a couple of minutes later, be refused for
 * `settling: claim`, and be written up as the product failing to clear. It was right.
 *
 * THERE IS NO DRAIN DOOR, AND THERE SHOULD NOT BE: `va_running:*` is a ledger key and the
 * kvSet allow-list keeps the harness out of the ledger on purpose. The marker ages out on
 * its own, so this WAITS for it and says how long — an honest slow test beats a fast lie.
 * The wait is bounded; if the marker is still live at the bound the caller is told, and the
 * measurement that depends on it becomes N/V rather than a FAIL against the product.
 */
async function waitOutClaim(jobId, maxWaitMs) {
  const key = `va_running:${jobId}`;
  const started = Date.now();
  let row = (await kvs(key)).value;
  const first = row;
  while (Date.now() - started < maxWaitMs) {
    row = (await kvs(key)).value;
    const takeAt = Date.parse((row && row.newestTakeAt) || "");
    if (!row || !Number.isFinite(takeAt)) return { live: false, waitedMs: Date.now() - started, first, row, why: row ? "marker carries no readable newestTakeAt" : "no marker" };
    const liveUntil = takeAt + SETTLE_MS;
    if (Date.now() >= liveUntil) return { live: false, waitedMs: Date.now() - started, first, row, why: "the marker aged out of the settle window" };
    const leftS = Math.ceil((liveUntil - Date.now()) / 1000);
    info(`${key}: newestTakeAt=${row.newestTakeAt}, live for another ~${leftS}s — waiting (this is tick 1's fan-out claim, not a product fault)`);
    await sleep(Math.min(20000, (liveUntil - Date.now()) + 2000));
  }
  return { live: true, waitedMs: Date.now() - started, first, row, why: "still live at the wait bound" };
}

async function pause(jobId, paused) {
  const cur = await invoke("getScheduledJob", { id: jobId });
  const j = cur.body && cur.body.job;
  if (!j) return false;
  const r = await invoke("saveScheduledJob", { job: { ...j, va: { ...j.va, status: { ...j.va.status, paused } } } });
  return !!(r.body && r.body.success);
}

async function main() {
  console.log(`\nF-575/F-585 — THE SETTLE WINDOW, driven through the F-616 tombstone door, on ${ENV_NAME.toUpperCase()}, project ${PROJECT}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  /* ── capability ─────────────────────────────────────────────────────────── */
  const cap0 = await invoke("getAgentCapability", {});
  info(`getAgentCapability before: ${JSON.stringify(cap0.body)}`);
  info(`model flip: ${FLIP_MODEL ? "ON" : "OFF"} - ${FLIP_MODEL_REASON}`);
  const instanceFlip = decideInstanceFlip({ cap: cap0.body || {}, frontier: FRONTIER, envName: ENV_NAME });
  if (FLIP_MODEL) info(`the instance's own reading: ${instanceFlip.reason}`);
  if (FLIP_MODEL && instanceFlip.blocked) {
    /* Off for something no model flip can fix: the lib's flag-less arm says so, with the remedy. */
    const blocked = judgeAgentCapability({ cap: cap0.body || {}, flipped: false, envName: ENV_NAME, frontier: FRONTIER });
    applyVerdict(blocked, { PASS, FAIL, NV });
    return;
  }
  if (FLIP_MODEL && instanceFlip.flip) {
    const slot = await kvs(AGENT_MODEL_SLOT);
    restore.agentModelSlot = slot.value;
    info(`${AGENT_MODEL_SLOT} recorded before the flip: ${slot.value === null ? "EMPTY" : JSON.stringify(slot.value)}`);
    const set = await invoke("saveAgentModel", { model: FRONTIER });
    if (!(set.body && set.body.success)) throw new Error(`saveAgentModel refused: ${JSON.stringify(set.body).slice(0, 300)}`);
    info("waiting 35s for the ~30s provider/model config cache");
    await sleep(35000);
  }
  const cap1 = await invoke("getAgentCapability", {});
  /* F-767/F-776 - ONE home. A provider slot that never came on leaves the settle window
     UNPROVEN, with the remedy named; it is not a defect in the settle window. */
  const capVerdict = judgeAgentCapability({ cap: cap1.body || {}, flipModel: FLIP_MODEL, envName: ENV_NAME, frontier: FRONTIER });
  applyVerdict(capVerdict, { PASS, FAIL, NV });
  if (!capVerdict.proceed) return;

  const cBefore = await commentTotal();
  info(`${PROJECT} before: ${JSON.stringify(cBefore)}`);

  /* ── STEP 0 — F-616: the product path this script used to take is CLOSED ─── */
  console.log("\nSTEP 0 - the id door (F-616): a save naming an unknown id must be REFUSED");
  {
    const planted = await invoke("saveScheduledJob", { job: { id: `job_f616_probe_${Date.now().toString(36)}`, name: "F-616 probe", mode: "va", enabled: true, va: vaRecord() } });
    ev.f616Probe = planted.body;
    if (planted.body && planted.body.success === false) {
      PASS("saveScheduledJob refuses a job id that names no row", { error: planted.body.error });
    } else {
      FAIL("a save with an unknown id still CREATED a job — F-616 is open on this build", { body: JSON.stringify(planted.body).slice(0, 300) });
      if (planted.body && planted.body.job && planted.body.job.id) {
        await invoke("deleteScheduledJob", { id: planted.body.job.id });
        info("the planted row was deleted again");
      }
    }
  }

  /* ── STEP 1 — agent A, one prepare tick, the ledger read while it lives ─── */
  console.log("\nSTEP 1 - create agent A, tick it once so the ledger and its claim rows exist");
  const created = await invoke("saveScheduledJob", { job: { name: `F-575 settle proof ${Date.now()}`, mode: "va", enabled: true, va: vaRecord() } });
  if (!(created.body && created.body.success)) throw new Error(`saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 400)}`);
  const jobId = created.body.job.id;
  restore.agentId = jobId;
  const createdAtA = created.body.job.createdAt;
  PASS(`agent A ${jobId} created (createdAt=${createdAtA})`);
  const t1 = await tick(jobId, "tick 1");
  info(`tick 1: ${JSON.stringify({ newReceipt: t1 && t1.newReceipt, ranAtAll: t1 && t1.ranAtAll })} receipt=${JSON.stringify(t1 && t1.receipt).slice(0, 300)}`);
  if (t1 && t1.newReceipt) PASS("a normal tick produces a prepare receipt — the control for STEP 3");
  else NV("the first tick produced no prepare receipt; the 'no receipt' assertion below is weaker for it", { t1: t1 && { ranAtAll: t1.ranAtAll } });
  await pause(jobId, true);
  info("agent A is PAUSED so the planner cannot enqueue a post run");

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
  if (tombBefore === null) PASS("no tombstone stands before the plant");
  else FAIL("a tombstone was already standing before the plant", { tombBefore });

  /* ── STEP 3 — plant the tombstone, then tick INSIDE the window ───────────── */
  console.log("\nSTEP 3 - plant a tombstone for A (the F-616 hook door), then tick INSIDE the window");
  const planted = await tombstone("plant", jobId);
  ev.plant = planted.body;
  if (!(planted.status === 200 && planted.body && planted.body.ok)) { FAIL("the tombstone door refused the plant", { status: planted.status, body: planted.raw || JSON.stringify(planted.body).slice(0, 300) }); return; }
  restore.tombstoneFor = jobId;
  const plantedAtMs = Date.parse(planted.body.row.at);
  PASS(`va_purged:${jobId} planted`, { at: planted.body.row.at, jobCreatedAt: planted.body.jobCreatedAt, clamped: planted.body.clampedToCreatedAt });
  if (plantedAtMs < Date.parse(createdAtA)) {
    PASS("the planted `at` PREDATES the job's createdAt — the clear will weigh the settle window, not `tombstone_newer_than_job`");
  } else {
    FAIL("the planted tombstone is newer than the job — the wrong branch would be proved", { at: planted.body.row.at, createdAt: createdAtA });
    return;
  }
  const standing = (await kvs(`va_purged:${jobId}`)).value;
  if (standing && standing.at) PASS("the tombstone is readable through the ordinary KVS read"); else FAIL("the planted tombstone is not readable", { standing });

  const tIn = await tick(jobId, "tick inside the window", 180);
  const ageAtTick = Date.now() - plantedAtMs;
  ev.insideWindow = { newReceipt: tIn && tIn.newReceipt, ranAtAll: tIn && tIn.ranAtAll, logs: tIn && { before: tIn.logsBefore, after: tIn.logsAfter }, ageAtTickMs: ageAtTick, settleMs: SETTLE_MS };
  info(`tick inside: ${JSON.stringify(ev.insideWindow)}`);
  if (!(tIn && tIn.ranAtAll)) {
    NV("no evidence the in-window tick ran at all (no new receipt AND no new execution log) — nothing to judge", ev.insideWindow);
  } else if (ageAtTick >= SETTLE_MS) {
    NV("the in-window tick landed AFTER the settle window had already retired — re-run; the window is not what was measured", ev.insideWindow);
  } else {
    if (tIn.newReceipt === false) PASS("the tick did NO WORK: it ran (an execution log landed) and produced NO prepare receipt", ev.insideWindow);
    else FAIL("the tick inside the window produced a prepare receipt — it was not gated", { receipt: JSON.stringify(tIn.receipt).slice(0, 400) });
  }
  /* F-797 — A TOMBSTONE READ IS ONLY EVIDENCE IF A TICK RAN. With no proof the tick ran,
     "it still stands" is satisfied by a consumer that never woke up, which is the vacuous
     PASS half of the same defect as the vacuous FAIL below. Both arms hang off liveness. */
  const tombStill = (await kvs(`va_purged:${jobId}`)).value;
  if (!(tIn && tIn.ranAtAll)) NV("the tombstone is not graded for the in-window tick: there is no evidence that tick ran, so neither its standing nor its absence proves anything", { tombStill, liveness: tIn && tIn.liveness });
  else if (tombStill && tombStill.at) PASS("the tombstone still STANDS after the in-window tick", { at: tombStill.at, liveness: tIn.liveness });
  else FAIL("the tombstone was cleared inside the settle window", { tombStill, liveness: tIn.liveness });

  /* ── STEP 4 — age the tombstone past the window, tick again ──────────────── */
  console.log("\nSTEP 4 - age the tombstone past VA_PURGE_SETTLE_MS through the same door, then tick");
  const aged = await tombstone("age", jobId, { ageMs: SETTLE_MS + 60000 });
  ev.age = aged.body;
  if (!(aged.status === 200 && aged.body && aged.body.ok && aged.body.effectiveAgeMs >= SETTLE_MS)) { FAIL("the age op did not move the tombstone past the window", { status: aged.status, body: JSON.stringify(aged.body).slice(0, 300) }); return; }
  PASS("the tombstone is now older than the settle window", { at: aged.body.row.at, effectiveAgeMs: aged.body.effectiveAgeMs });

  /* F-797 — condition 3 before condition 2's tick. See `waitOutClaim`. */
  const claimWait = await waitOutClaim(jobId, SETTLE_MS + 90000);
  ev.claimWait = { live: claimWait.live, waitedMs: claimWait.waitedMs, why: claimWait.why, first: claimWait.first, row: claimWait.row };
  info(`va_running drain: ${JSON.stringify(ev.claimWait).slice(0, 300)}`);
  if (!claimWait.live) PASS("tick 1's fan-out claim has aged out of the settle window, so the clear is not being refused on condition 3", { waitedS: Math.round(claimWait.waitedMs / 1000), why: claimWait.why });
  else NV("va_running is STILL live at the wait bound — the after-window clear cannot be attributed to the settle window, so the tombstone is not graded below", ev.claimWait);

  const tAfter = await tick(jobId, "tick after the window", 240);
  const rAfter = tAfter && tAfter.receipt;
  ev.afterWindow = { newReceipt: tAfter && tAfter.newReceipt, ranAtAll: tAfter && tAfter.ranAtAll, receipt: rAfter };
  info(`tick after: ${JSON.stringify(ev.afterWindow).slice(0, 600)}`);
  const skipAfter = (rAfter && Array.isArray(rAfter.skipped) && rAfter.skipped) || [];
  const gateAfter = skipAfter.find((s) => s && s.gate === "purge-settling");
  if (rAfter && !gateAfter) PASS("the tick after the window is a NORMAL prepare receipt with no purge gate", { phase: rAfter.phase, swept: rAfter.swept, worked: rAfter.worked, skipped: skipAfter.length });
  else if (gateAfter) FAIL("the tick after the window is STILL gated", { gate: gateAfter });
  else if (tAfter && tAfter.ranAtAll) FAIL("the tick after the window ran but produced no prepare receipt — it is still doing nothing", ev.afterWindow);
  else NV("no evidence the tick after the window ran at all", ev.afterWindow);
  /* F-797 — THE FAIL THAT ACCUSED THE PRODUCT. This was unconditional: a run whose
     liveness was N/V, or whose clear was refused on the claim check rather than on the
     settle window, still graded a standing tombstone a FAILURE. A measurement that could
     not be taken is NOT a measurement that came out negative, and the two must never print
     the same word. A clear is only graded when BOTH preconditions held. */
  const tombGone = (await kvs(`va_purged:${jobId}`)).value;
  const settlingAfter = (tAfter && tAfter.status && tAfter.status.settling) || null;
  const why = !(tAfter && tAfter.ranAtAll)
    ? "there is no evidence the after-window tick ran at all"
    : claimWait.live
      ? "tick 1's fan-out claim was still live, so `clearPurgeTombstone` refuses on condition 3 (the claim check) and not on the settle window this script measures"
      : null;
  if (why) NV(`the clear is NOT GRADED: ${why}`, { tombGone, settling: settlingAfter, liveness: tAfter && tAfter.liveness, claimLive: claimWait.live });
  else if (tombGone === null) { PASS(`the tombstone va_purged:${jobId} is GONE (the same read saw it twice above)`, { liveness: tAfter.liveness }); restore.tombstoneFor = null; }
  else FAIL("the tombstone is still standing after the window, with the tick proven to have run and no live claim to refuse on", { tombGone, settling: settlingAfter, liveness: tAfter.liveness });

  const cAfter = await commentTotal();
  ev.comments = { before: cBefore, after: cAfter };
  if (cAfter.comments === cBefore.comments) PASS("no comment was posted anywhere in the project", { before: cBefore.comments, after: cAfter.comments });
  else FAIL("the comment count moved", { before: cBefore.comments, after: cAfter.comments });
  ev.jobId = jobId;
}

try { await main(); } catch (e) { crashed = e; console.error("THREW", e.stack); fails += 1; }
finally {
  try {
    // The planted tombstone is cleared through the SAME door that planted it — it is the
    // one piece of state this script writes that is not an agent, and a stray one would
    // mute a re-run of the same id for three days.
    if (restore.tombstoneFor) {
      const c = await tombstone("clear", restore.tombstoneFor);
      info(`cleanup tombstone clear ${restore.tombstoneFor}: ${c.status}`);
    }
    if (restore.agentId && !KEEP) {
      const r = await invoke("deleteScheduledJob", { id: restore.agentId });
      info(`cleanup deleteScheduledJob ${restore.agentId}: ${JSON.stringify(r.body).slice(0, 160)}`);
      const t = (await kvs(`va_purged:${restore.agentId}`)).value;
      info(`cleanup tombstone after delete: ${t ? t.at : "(none)"} — it carries VA_PURGED_TTL and ages out on its own`);
    }
    if (restore.agentModelSlot !== undefined) {
      const r = await hook({ action: "kvSet", key: AGENT_MODEL_SLOT, value: restore.agentModelSlot });
      if (r.status === 200) PASS(`${AGENT_MODEL_SLOT} restored to its recorded value`);
      else FAIL(`${AGENT_MODEL_SLOT} restore did not confirm`, { status: r.status });
    }
  } catch (e) { console.error("CLEANUP FAILED", e.message); fails += 1; }
  /* F-787 - WHICH COMMIT PRODUCED THIS FILE. Evidence is read weeks later beside a findings
     row, and until now nothing in it said what code wrote it; `dirty` is reported because
     evidence produced from uncommitted edits is not reproducible from the commit it names. */
  ev.provenance = runProvenance();
  fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
  console.log("\n" + formatResultLine({ passes, fails, unproven, crashed, suffix: `. Evidence: ${OUT}/evidence.json` }));
  process.exit(resultExitCode({ fails, crashed }));
}
