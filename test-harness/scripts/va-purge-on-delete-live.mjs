/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-469 - THE VA LEDGER PURGE ON DELETE, PROVEN ON ROWS THAT ACTUALLY EXIST.
 *
 * `va_index:{agent}`, `va_health:{agent}`, `va_memory:{agent}` and `va_item:{agent}:*`
 * carry NO TTL by design, so if `deleteScheduledJob` has no VA cleanup arm they orphan
 * for ever. Its sibling `va-capability-gate-live.mjs` can only reach `va_health` on DEV,
 * because the F-482 capability gate refuses the tick before any item row is written.
 *
 * SO THIS ONE RUNS ON STAGING, which is the same build (main 6d13d02) on an ADVANCED
 * edition whose only missing capability is the frontier model. It flips the AGENT MODEL
 * to a frontier one, lets a real prepare tick STAGE ITEM ROWS, deletes the agent and
 * reads every key back - then puts the model back exactly as it found it, in a `finally`.
 *
 * A NEGATIVE IS PROVEN, NEVER OBSERVED. Every key checked after the delete is read
 * BEFORE it through the same `?what=kvs` query, and a key that was never there is
 * reported NOT VERIFIED rather than counted as a clean purge.
 *
 * NOTHING IS POSTED. The agent is created with `shadowUntilTick: 3` and `replyInternal`
 * as its only power, it is PAUSED the moment the tick lands so the five-minute planner
 * cannot enqueue a post run for it, and the JT comment counts are read before and after
 * with a positive control, exactly as `va-shadow-live.mjs` does.
 *
 * Usage (from test-harness/):
 *   node scripts/va-purge-on-delete-live.mjs                 # staging (the default here)
 *   node scripts/va-purge-on-delete-live.mjs --env=dev       # will stop: capability is off
 *   node scripts/va-purge-on-delete-live.mjs --keep
 *
 * Env: STAGING_TESTSTATE_URL (or TESTSTATE_URL with --env=dev) + HARNESS_SECRET +
 * HARNESS_ADMIN_ACCOUNT_ID + the JIRA_* trio. Nothing secret is printed.
 */

import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
/* F-782 — the flip decision and the precondition verdict have ONE home, and it is not here. */
import { decideInstanceFlip, judgeAgentCapability } from "../lib/agent-capability-precondition.mjs";

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
const KEEP = flag("keep");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const PASS = (s) => { passes++; console.log(`  PASS  ${s}`); };
const FAIL = (s) => { fails++; console.log(`  FAIL  ${s}`); };
const NV = (s) => { unproven++; console.log(`  N/V   ${s}`); };
const info = (s) => console.log(`        ${s}`);

/** Everything this run changed, restored in the finally whatever happened. */
/*
 * THE RAW SLOT, NOT THE RESOLVER'S ANSWER. `getAgentModel` answers with the FALLBACK
 * when the slot is empty (dev's `COGNIRUNNER_AGENT_MODEL_atlassian` is `null` and the
 * resolver still says `claude-haiku-4-5-20251001`), and `saveAgentModel` then REFUSES to
 * write that fallback back on an Advanced tenant ("Agents on Atlassian run on Claude
 * Sonnet 5 or Opus 5 only") - so restoring through the resolver is impossible and the
 * first run of this script left the slot dirty. The restore therefore records and
 * replays the KVS SLOT itself, through the hook's `kvSet` action, whose allow-list
 * already carries every provider slot (`providerSlotsFor`).
 */
const AGENT_MODEL_SLOT = "COGNIRUNNER_AGENT_MODEL_atlassian";
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
  /* F-699 — the "which variable do I set" sentence has ONE home now: `requireEnvAck`
     refuses at startup and names it, so by the time any hook call runs HOOK_URL is set. */
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
async function commentCounts(keys) {
  const out = {};
  for (const k of keys) { const r = await jira(`/rest/api/3/issue/${k}/comment?maxResults=1`); out[k] = r.status === 200 && r.json ? Number(r.json.total) : `ERR:${r.status}`; }
  return out;
}

const receiptsOf = (s) => (s && Array.isArray(s.receipts) ? s.receipts : []);
const latest = (s, phase) => receiptsOf(s).filter((r) => r.phase === phase)[0] || null;

const vaRecord = () => ({
  persona: { name: "Purge", voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: { serviceDesks: [{ serviceDeskId: DESK_ID, queueIds: QUEUES }], jql: `project = ${PROJECT}`, mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: 3, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 3, maxWritesPerRun: 10 },
  status: { paused: false, shadowUntilTick: 3 },
});

async function main() {
  console.log(`\nF-469 - THE VA LEDGER PURGE ON DELETE, on ${ENV_NAME.toUpperCase()}, project ${PROJECT}\n`);

  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  /* ── STEP 0 — turn the capability ON, and record what to put back ────────── */
  console.log("\nSTEP 0 - the capability this proof needs");
  const cap0 = await invoke("getAgentCapability", {});
  info(`getAgentCapability before: ${JSON.stringify(cap0.body)}`);
  const flip = decideInstanceFlip({ cap: cap0.body || {}, frontier: FRONTIER, envName: ENV_NAME });
  info(`model flip: ${flip.flip ? "ON" : "OFF"} - ${flip.reason}`);
  if (flip.flip) {
    const slot = await kvs(AGENT_MODEL_SLOT);
    restore.agentModelSlot = slot.value;
    const cur = await invoke("getAgentModel", {});
    info(`${AGENT_MODEL_SLOT} is ${slot.value === null ? "EMPTY (the resolver's answer \"" + (cur.body && cur.body.model) + "\" is the fallback)" : `"${slot.value}"`} - the SLOT is what the finally puts back`);
    const set = await invoke("saveAgentModel", { model: FRONTIER });
    if (!(set.body && set.body.success)) throw new Error(`saveAgentModel refused: ${JSON.stringify(set.body).slice(0, 300)}`);
    // The provider/model config is TTL-cached ~30s in index.js.
    info("waiting 35s for the ~30s provider/model config cache to clear");
    await sleep(35000);
  }
  const cap1 = flip.flip ? (await invoke("getAgentCapability", {})).body : cap0.body;
  info(`getAgentCapability now: ${JSON.stringify(cap1)}`);
  /* F-767/F-782 — ONE home for the verdict. A provider slot that never came on leaves F-469's
     item arm UNPROVEN, with the remedy named; it is not a defect in the purge under test. */
  const capVerdict = judgeAgentCapability({ cap: cap1 || {}, flipped: flip.flip, envName: ENV_NAME, frontier: FRONTIER });
  ({ PASS, FAIL, NV }[capVerdict.verdict])(capVerdict.what);
  if (!capVerdict.proceed) return;

  /* ── the baseline ───────────────────────────────────────────────────────── */
  const search = await jira(`/rest/api/3/search/jql?jql=${encodeURIComponent(`project = ${PROJECT} ORDER BY created DESC`)}&maxResults=100&fields=summary`);
  const keys = ((search.json && search.json.issues) || []).map((i) => i.key);
  const cBefore = await commentCounts(keys);
  info(`${PROJECT}: ${keys.length} issue(s); comment counts before: ${JSON.stringify(cBefore)}`);

  /* ── STEP 1 — the agent ─────────────────────────────────────────────────── */
  console.log("\nSTEP 1 - create the agent and run ONE prepare tick");
  const created = await invoke("saveScheduledJob", { job: { name: "F-469 purge proof", mode: "va", enabled: true, va: vaRecord() } });
  if (!(created.body && created.body.success)) throw new Error(`saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 400)}`);
  const jobId = created.body.job.id;
  restore.agentId = jobId;
  PASS(`agent ${jobId} created, shadowUntilTick=${created.body.job.va.status.shadowUntilTick}`);

  const ran = await invoke("runScheduledJobNow", { id: jobId });
  if (!(ran.body && ran.body.success)) throw new Error(`runScheduledJobNow refused: ${JSON.stringify(ran.body)}`);
  PASS(`va-tick enqueued, taskId=${ran.body.taskId}`);

  const deadline = Date.now() + TICK_WAIT_S * 1000;
  let st = null;
  while (Date.now() < deadline) {
    const r = await invoke("getVaStatus", { jobId });
    st = r.body && r.body.success ? r.body : null;
    if (st && Number(st.staged) >= 1) break;
    await sleep(8000);
  }
  const prep = latest(st, "prepare");
  info(`prepare receipt: ${JSON.stringify(prep).slice(0, 500)}`);
  info(`staged: ${st && st.staged}`);

  // PAUSE IMMEDIATELY: the five-minute planner enqueues a post run for every ENABLED
  // agent, and this script's business is the ledger, not the post gates.
  const cur = await invoke("getScheduledJob", { id: jobId });
  const curJob = cur.body && cur.body.job;
  await invoke("saveScheduledJob", { job: { ...curJob, va: { ...curJob.va, status: { ...curJob.va.status, paused: true } } } });
  info("the agent is PAUSED, so the planner cannot enqueue a post run for it");

  const dr = await invoke("listVaDrafts", { jobId });
  const drafts = (dr.body && dr.body.drafts) || [];
  info(`listVaDrafts: ${drafts.length} staged draft(s) - ${drafts.map((d) => d.itemKey).join(", ") || "none"}`);
  /*
   * THE ITEM KEYS COME FROM `va_index`, NOT FROM THE DRAFTS. A fanned-out item writes a
   * `va_item:` row whatever its turn concludes - staged, parked, nothing to say - and
   * `listVaDrafts` only shows the STAGED ones. Reading the purge off the drafts (as the
   * first version of this script did) silently skipped every row the tick actually made:
   * worked=3, staged=0, and `va_index.ids` held three keys the whole time.
   */
  const idx = (await kvs(`va_index:${jobId}`)).value;
  const itemKeys = (idx && Array.isArray(idx.ids) ? idx.ids : []).concat(drafts.map((d) => d.itemKey));
  const ITEMS = [...new Set(itemKeys)];
  info(`va_index.ids -> ${ITEMS.join(", ") || "none"} (parked=${idx && idx.parked})`);
  if (!ITEMS.length) NV(`no item row was made on this tick (swept=${prep && prep.swept} worked=${prep && prep.worked}), so the va_item purge arm cannot be judged`);

  /* ── STEP 2 — the keys, BEFORE the delete ───────────────────────────────── */
  console.log("\nSTEP 2 - every ledger key, read through ?what=kvs while the agent LIVES");
  const KEYS = [`va_index:${jobId}`, `va_health:${jobId}`, `va_memory:${jobId}`, ...ITEMS.map((k) => `va_item:${jobId}:${k}`)];
  const seenBefore = {};
  for (const k of KEYS) {
    const v = (await kvs(k)).value;
    seenBefore[k] = v;
    info(`${k} -> ${v === null ? "(absent)" : JSON.stringify(v).slice(0, 160)}`);
  }
  const present = KEYS.filter((k) => seenBefore[k] !== null && seenBefore[k] !== undefined);
  if (present.length) PASS(`${present.length} of ${KEYS.length} key(s) are READABLE through this query while the agent lives - the positive control every "gone" below rests on`);
  else { FAIL("no ledger key could be read at all, so the purge cannot be judged"); return; }

  /* ── STEP 3 — delete, then read back ────────────────────────────────────── */
  console.log("\nSTEP 3 - delete the agent, then read every key again");
  const del = await invoke("deleteScheduledJob", { id: jobId });
  if (del.body && del.body.success) { PASS(`deleteScheduledJob: ${JSON.stringify(del.body).slice(0, 160)}`); restore.agentId = null; }
  else FAIL(`deleteScheduledJob refused: ${JSON.stringify(del.body).slice(0, 300)}`);
  const gone = await invoke("listVaAgents", {});
  if (!((gone.body && gone.body.agents) || []).some((a) => a.id === jobId)) PASS("listVaAgents no longer lists it");
  else FAIL(`listVaAgents still lists ${jobId}`);

  const orphans = [];
  for (const k of KEYS) {
    const after = (await kvs(k)).value;
    const existed = seenBefore[k] !== null && seenBefore[k] !== undefined;
    if (!existed) { NV(`${k}: never present while the agent lived, so its absence proves nothing`); continue; }
    if (after === null || after === undefined) PASS(`${k}: present before, GONE after - purged`);
    else { FAIL(`${k}: ORPHANED - still readable after the delete: ${JSON.stringify(after).slice(0, 160)}`); orphans.push(k); }
  }
  if (orphans.length) info(`F-469 CONFIRMED on ${ENV_NAME}: ${orphans.length} row(s) survive the delete with no TTL to remove them`);

  /* ── the second read: nothing was posted ────────────────────────────────── */
  const cAfter = await commentCounts(keys);
  if (JSON.stringify(cAfter) === JSON.stringify(cBefore)) PASS(`no ${PROJECT} comment count changed: ${JSON.stringify(cAfter)}`);
  else FAIL(`comment counts CHANGED: before ${JSON.stringify(cBefore)} after ${JSON.stringify(cAfter)}`);

  console.log(`\nRESULT - ${passes} pass, ${fails} fail, ${unproven} not verified`);
  if (fails) process.exitCode = 1;
}

main()
  .catch((e) => { console.error("\nDRIVER ERROR:", e && e.message); process.exitCode = 1; })
  /*
   * RESTORE IS AN ASSERTION, NOT A COURTESY. This script deletes an agent and REWRITES an
   * instance-wide model slot; a restore that silently no-ops leaves the next run reading a
   * setting this one planted. So the agent delete is re-read through `getScheduledJob`
   * (never `success:true` alone), the slot is re-read through the same `?what=kvs` query
   * that could see it before, and either kind of residue exits non-zero, named.
   */
  .finally(async () => {
    console.log("\nRESTORE");
    const residue = [];
    if (restore.agentId && !KEEP) {
      const r = await invoke("deleteScheduledJob", { id: restore.agentId }).catch((e) => ({ body: { error: e.message } }));
      console.log(`        deleteScheduledJob ${restore.agentId}: ${JSON.stringify(r.body).slice(0, 160)}`);
      const back = await invoke("getScheduledJob", { id: restore.agentId }).catch((e) => ({ body: { error: e.message } }));
      const survives = !!(back && back.body && back.body.job);
      console.log(`        second read getScheduledJob ${restore.agentId}: ${survives ? "STILL PRESENT" : "gone"}`);
      if (survives) residue.push(`the agent ${restore.agentId} survived its delete`);
    }
    if (restore.agentModelSlot !== undefined) {
      const r = await hook({ action: "kvSet", key: AGENT_MODEL_SLOT, value: restore.agentModelSlot }).catch((e) => ({ json: { error: e.message } }));
      console.log(`        kvSet ${AGENT_MODEL_SLOT} -> ${JSON.stringify(r.json).slice(0, 160)}`);
      const back = await kvs(AGENT_MODEL_SLOT).catch(() => null);
      // `back.ok` matters: a FAILED read also yields value:null, which would read as a
      // successful restore whenever the pre-run value was itself null.
      const ok = !!(back && back.ok && JSON.stringify(back.value) === JSON.stringify(restore.agentModelSlot));
      console.log(`        ${ok ? "RESTORED" : "NOT RESTORED"}: the slot reads back ${JSON.stringify(back && back.value)} (was ${JSON.stringify(restore.agentModelSlot)})`);
      if (!ok) residue.push(`${AGENT_MODEL_SLOT} still holds ${JSON.stringify(back && back.value)} instead of the pre-run ${JSON.stringify(restore.agentModelSlot)}`);
      const cap = await invoke("getAgentCapability", {}).catch(() => null);
      console.log(`        getAgentCapability after the restore: ${JSON.stringify(cap && cap.body)}`);
    }
    if (residue.length) {
      console.error(`\nRESTORE FAILED — the instance is NOT as this run found it:\n        ${residue.join("\n        ")}`);
      process.exitCode = 1;
    }
  });
