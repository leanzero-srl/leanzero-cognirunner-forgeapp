/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-482 (the VA capability gate) and F-469 (purge on delete), LIVE.
 *
 * F-482: `src/virtual-admin.js` asks `deps.capability()` BEFORE the sweep. On an instance
 * whose `getAgentCapability` answers `{enabled:false, reason:"needs-coder-edition"}` the
 * WHOLE prepare tick must refuse: the receipt names the gate, the health counter takes a
 * FAILURE (so the banner appears), `prepareTicks` does NOT move (so shadow mode is not
 * burned by a tick nobody could watch), and no `va-item` task is ever enqueued.
 *
 * F-469: `deleteScheduledJob` has no VA cleanup arm, and `va_index:` / `va_health:` /
 * `va_memory:` carry no TTL. After the delete this script READS those rows back through
 * the hook's unrestricted `?what=kvs` GET. An orphan is a FAIL, not a footnote.
 *
 * WHY THE DOORS ARE THE ONES THEY ARE. `runVaTickNow`, `pauseVa` and `vaCatalog` are
 * deliberately off `src/test-hook.js`'s `invokeResolver` allow-list. This script reaches
 * the identical task body through `runScheduledJobNow` -> `enqueueJobRun` -> `isVaJob` ->
 * the same `va-tick` push the scheduler makes, exactly as `va-shadow-live.mjs` does.
 *
 * A NEGATIVE IS PROVEN, NEVER OBSERVED. "the row is gone" is only evidence once the same
 * `?what=kvs` query has been shown to READ that row while the agent existed, so every
 * key checked after the delete is read BEFORE it too, and a key that was never present
 * beforehand is reported NOT VERIFIED rather than counted as a clean purge.
 *
 * Usage (from test-harness/):
 *   node scripts/va-capability-gate-live.mjs
 *   node scripts/va-capability-gate-live.mjs --keep        # leave the agent in place
 *   node scripts/va-capability-gate-live.mjs --tickwait=240
 *
 * Env: TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 * Nothing secret is printed - not the trigger URL, not the Bearer.
 */

import { loadEnv, requireEnv } from "../lib/env.mjs";

const env = loadEnv();
const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const flag = (n) => process.argv.slice(2).includes(`--${n}`);

const ENV_NAME = arg("env", "dev");
const HOOK_URL = ENV_NAME === "dev" ? env.TESTSTATE_URL : env.STAGING_TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "JT");
const DESK_ID = arg("desk", "1");
const QUEUES = arg("queues", "1,2,3").split(",").filter(Boolean);
const TICK_WAIT_S = Number(arg("tickwait", "180"));
const KEEP = flag("keep");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
let createdJobId = null;
const PASS = (s) => { passes++; console.log(`  PASS  ${s}`); };
const FAIL = (s) => { fails++; console.log(`  FAIL  ${s}`); };
const NV = (s) => { unproven++; console.log(`  N/V   ${s}`); };
const info = (s) => console.log(`        ${s}`);

async function fetchRetry(url, init, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; console.log(`        (transport retry ${i + 1}/${tries}: ${e.message})`); await sleep(2000 * (i + 1)); }
  }
  return { __transportError: last };
}

async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  const res = await fetchRetry(HOOK_URL + qs, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  if (res && res.__transportError) return { status: 0, json: null, raw: `transport: ${res.__transportError.message}` };
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, json: null, raw: `body: ${e.message}` }; }
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, raw: json ? null : text.slice(0, 300) };
}

async function invoke(functionKey, payload = {}) {
  const r = await hook({ action: "invokeResolver", functionKey, payload, accountId: ADMIN });
  return { status: r.status, body: r.json, raw: r.raw };
}

/** Read ONE KVS row through the hook's unrestricted GET read. `undefined` = absent. */
async function kvs(key) {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`);
  if (r.status !== 200 || !r.json) return { ok: false, value: null, status: r.status };
  return { ok: true, value: r.json.value === undefined ? null : r.json.value };
}

const receiptsOf = (s) => (s && Array.isArray(s.receipts) ? s.receipts : []);
const latest = (s, phase) => receiptsOf(s).filter((r) => r.phase === phase)[0] || null;

const vaRecord = () => ({
  persona: { name: arg("persona", "Cap"), voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: { serviceDesks: [{ serviceDeskId: DESK_ID, queueIds: QUEUES }], jql: `project = ${PROJECT}`, mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: 3, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 5, maxWritesPerRun: 10 },
  status: { paused: false, shadowUntilTick: 3 },
});

async function main() {
  console.log(`\nF-482 CAPABILITY GATE + F-469 PURGE ON DELETE - live on ${ENV_NAME.toUpperCase()}, project ${PROJECT}\n`);

  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable / the secret was rejected (GET -> ${ping.status}). Rotating HARNESS_SECRET needs a redeploy of ${ENV_NAME}.`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  /* ── STEP 0 — the instance's own answer, and a clean floor ──────────────── */
  console.log("\nSTEP 0 - what this instance says about agent capability");
  const cap = await invoke("getAgentCapability", {});
  const capBody = cap.body || {};
  info(`getAgentCapability -> ${JSON.stringify(capBody)}`);
  if (capBody.enabled === false) PASS(`capability is OFF: reason="${capBody.reason}" edition=${capBody.edition} provider=${capBody.provider}`);
  else { FAIL(`capability is ON (enabled=${capBody.enabled}) - this script proves the REFUSAL and cannot run here`); return; }
  const EXPECT_REASON = capBody.reason;

  const pre = await invoke("listVaAgents", {});
  if (!(pre.body && pre.body.success)) throw new Error(`listVaAgents refused: ${JSON.stringify(pre.body)}`);
  info(`listVaAgents before: ${pre.body.agents.length} agent(s)`);

  /* ── STEP 1 — create the agent ───────────────────────────────────────────── */
  console.log("\nSTEP 1 - create a Virtual Administrator on an INCAPABLE instance");
  const created = await invoke("saveScheduledJob", { job: { name: `F-482 capability proof`, mode: "va", enabled: true, va: vaRecord() } });
  if (!(created.body && created.body.success)) throw new Error(`saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 500)}`);
  const job = created.body.job;
  const jobId = job.id;
  createdJobId = jobId;
  PASS(`agent created: ${jobId} mode=${job.mode} cron="${job.schedule.cron}"`);
  info(`refused[]: ${JSON.stringify(created.body.refused || [])}`);
  info(`F-485 note: the SAVE door accepted this agent on an instance whose capability is "${EXPECT_REASON}".`);

  /* ── the BEFORE read of every ledger key (a negative must be provable) ───── */
  console.log("\nBASELINE - the ledger keys, read through ?what=kvs BEFORE the tick");
  const KEYS = [`va_index:${jobId}`, `va_health:${jobId}`, `va_memory:${jobId}`];
  const beforeRows = {};
  for (const k of KEYS) { const r = await kvs(k); beforeRows[k] = r.value; info(`${k} -> ${r.value === null ? "(absent)" : JSON.stringify(r.value).slice(0, 220)}`); }

  const st0 = await invoke("getVaStatus", { jobId });
  const shadow0 = st0.body && st0.body.shadow;
  info(`getVaStatus before the tick: shadow=${JSON.stringify(shadow0)} staged=${st0.body && st0.body.staged} health=${JSON.stringify(st0.body && st0.body.health)}`);

  /* ── STEP 2 — the tick ───────────────────────────────────────────────────── */
  console.log("\nSTEP 2 - run the prepare tick (runScheduledJobNow -> enqueueJobRun -> isVaJob -> the same va-tick the scheduler pushes)");
  const ran = await invoke("runScheduledJobNow", { id: jobId });
  if (!(ran.body && ran.body.success)) throw new Error(`runScheduledJobNow refused: ${JSON.stringify(ran.body)}`);
  PASS(`va-tick enqueued, taskId=${ran.body.taskId}`);

  const deadline = Date.now() + TICK_WAIT_S * 1000;
  let st = null, prep = null;
  while (Date.now() < deadline) {
    const r = await invoke("getVaStatus", { jobId });
    st = r.body && r.body.success ? r.body : null;
    prep = latest(st, "prepare");
    if (prep) break;
    await sleep(6000);
  }

  /* ── STEP 3 — the receipt ────────────────────────────────────────────────── */
  console.log("\nSTEP 3 - the receipt must NAME the gate");
  if (!prep) {
    FAIL(`no prepare receipt within ${TICK_WAIT_S}s`);
  } else {
    info(`prepare receipt: ${JSON.stringify(prep).slice(0, 600)}`);
    const sk = Array.isArray(prep.skipped) ? prep.skipped : [];
    const agentRow = sk.find((r) => r && r.itemKey === null);
    if (agentRow) PASS(`skipped[] carries an AGENT-level row (itemKey null, the "(agent)" sentinel): ${JSON.stringify(agentRow)}`);
    else FAIL(`skipped[] has no agent-level row: ${JSON.stringify(sk).slice(0, 400)}`);
    if (agentRow && agentRow.reason === EXPECT_REASON) PASS(`the reason is the capability read's own: "${agentRow.reason}"`);
    else if (agentRow) FAIL(`the receipt reason "${agentRow.reason}" is not the capability read's "${EXPECT_REASON}"`);
    // THE GATE NAME. `src/virtual-admin.js` writes `gate: "capability"` and `recordTick`
    // preserves it; `publicReceipt` in src/va-admin.js then rebuilds `gate` from the
    // REASON and never reads the stored field, so the gate name cannot reach the tab.
    if (agentRow && agentRow.gate === "capability") PASS(`the receipt names the GATE: gate="capability"`);
    else FAIL(`the receipt LOST the gate name: gate="${agentRow && agentRow.gate}" (the engine stored gate:"capability"; publicReceipt derives gate from reason)`);
    // The receipt's own field names are `swept` / `worked` (publicReceipt maps
    // candidates -> swept and staged -> worked), NOT the engine's argument names.
    if (Number(prep.swept) === 0) PASS(`swept = 0 - the sweep never ran (no JQL, no queue read)`);
    else FAIL(`swept = ${prep.swept} - the sweep RAN before the gate`);
    if (Number(prep.worked) === 0) PASS(`worked = 0 - nothing was fanned out`);
    else FAIL(`worked = ${prep.worked}`);
    // The engine calls this "A FAILED tick, deliberately" and moves the failure counter.
    if (prep.ok === false) PASS("the receipt reports ok = false, agreeing with the health row");
    else FAIL(`the receipt reports ok = ${prep.ok} while va_health took a FAILURE - the two surfaces disagree (publicReceipt derives ok from r.error, and the capability arm records no error)`);
  }

  /* ── STEP 4 — health, shadow, staged rows ────────────────────────────────── */
  console.log("\nSTEP 4 - the health banner, the shadow counter and the item rows");
  const healthRow = (await kvs(`va_health:${jobId}`)).value;
  info(`va_health:${jobId} -> ${JSON.stringify(healthRow)}`);
  if (healthRow && Number(healthRow.consecutiveFailures) >= 1) PASS(`the health row took a FAILURE: consecutiveFailures=${healthRow.consecutiveFailures} lastReason="${healthRow.lastReason}"`);
  else FAIL(`the health row did not take a failure: ${JSON.stringify(healthRow)}`);
  if (healthRow && String(healthRow.lastReason || "").includes(EXPECT_REASON)) PASS(`lastReason carries the capability reason: "${healthRow.lastReason}"`);
  else FAIL(`lastReason does not carry the capability reason: "${healthRow && healthRow.lastReason}"`);
  if (healthRow && (Number(healthRow.prepareTicks) || 0) === 0) PASS(`prepareTicks = ${Number(healthRow.prepareTicks) || 0} - a refused tick did NOT burn shadow mode`);
  else FAIL(`prepareTicks = ${healthRow && healthRow.prepareTicks} - the refused tick advanced the shadow counter`);

  const st1 = await invoke("getVaStatus", { jobId });
  const b = st1.body || {};
  info(`getVaStatus after the tick: health=${JSON.stringify(b.health)} shadow=${JSON.stringify(b.shadow)} staged=${b.staged} lastTick=${JSON.stringify(b.lastTick)}`);
  if (b.health && b.health.ok === false) PASS(`getVaStatus health.ok = false (failedTicks=${b.health.failedTicks})`);
  else if (b.health && b.health.failedTicks >= 1) PASS(`getVaStatus reports failedTicks=${b.health.failedTicks} (banner threshold not yet reached: health.ok=${b.health.ok})`);
  else FAIL(`getVaStatus health does not show the failure: ${JSON.stringify(b.health)}`);
  if (b.shadow && Number(b.shadow.tickIndex) === 0) PASS(`isInShadow still reports tickIndex=0, ticksLeft=${b.shadow.ticksLeft} - shadow NOT advanced`);
  else FAIL(`isInShadow moved or cleared: ${JSON.stringify(b.shadow)}`);
  if (Number(b.staged) === 0) PASS("staged = 0 through the resolver layer too");
  else FAIL(`staged = ${b.staged}`);

  const dr = await invoke("listVaDrafts", { jobId });
  const drafts = (dr.body && dr.body.drafts) || [];
  if (drafts.length === 0) PASS(`listVaDrafts is empty (${JSON.stringify(dr.body && dr.body.refused || null)})`);
  else FAIL(`listVaDrafts has ${drafts.length} draft(s) on a refused agent`);
  const eff = await invoke("listVaEffects", { jobId });
  const effects = (eff.body && eff.body.effects) || [];
  if (effects.length === 0) PASS("listVaEffects is empty - no outward act");
  else FAIL(`listVaEffects has ${effects.length} row(s)`);

  const idxRow = (await kvs(`va_index:${jobId}`)).value;
  info(`va_index:${jobId} after the tick -> ${idxRow === null ? "(absent)" : JSON.stringify(idxRow).slice(0, 300)}`);

  /* ── STEP 5 — delete, then the purge read (F-469) ────────────────────────── */
  if (KEEP) { console.log("\nSTEP 5 - SKIPPED (--keep)."); }
  else {
    console.log("\nSTEP 5 - F-469: delete the agent, then read every ledger key back");
    const seenBefore = {};
    for (const k of KEYS) seenBefore[k] = (await kvs(k)).value;
    const del = await invoke("deleteScheduledJob", { id: jobId });
    if (del.body && del.body.success) PASS(`deleteScheduledJob: ${JSON.stringify(del.body).slice(0, 200)}`);
    else FAIL(`deleteScheduledJob refused: ${JSON.stringify(del.body).slice(0, 300)}`);
    const listAfter = await invoke("listVaAgents", {});
    const still = ((listAfter.body && listAfter.body.agents) || []).find((a) => a.id === jobId);
    if (!still) PASS("listVaAgents no longer lists it");
    else FAIL(`listVaAgents still lists ${jobId}`);

    for (const k of KEYS) {
      const after = (await kvs(k)).value;
      const existed = seenBefore[k] !== null && seenBefore[k] !== undefined;
      if (!existed) { NV(`${k}: never present while the agent lived, so its absence now proves nothing about the purge`); continue; }
      if (after === null || after === undefined) PASS(`${k}: present before the delete, GONE after - purged`);
      else FAIL(`${k}: ORPHANED - still readable after the delete: ${JSON.stringify(after).slice(0, 200)}`);
    }
    console.log("\n  ITEM ROWS - the gate meant none were ever staged, so this arm is NOT VERIFIED here");
    NV("va_item:{agent}:* could not be tested on this instance: the capability gate refuses the tick BEFORE the sweep, so no item row is ever written. Proving the item-row purge needs an instance where capability is ON.");
  }

  console.log(`\nRESULT - ${passes} pass, ${fails} fail, ${unproven} not verified`);
  if (fails) process.exitCode = 1;
}

main()
  .catch((e) => { console.error("\nDRIVER ERROR:", e && e.message); process.exitCode = 1; })
  .finally(async () => {
    if (!createdJobId || KEEP) return;
    const check = await invoke("listVaAgents", {}).catch(() => null);
    const still = check && check.body && (check.body.agents || []).some((a) => a.id === createdJobId);
    if (!still) return;
    console.log(`\nCLEANUP - deleting ${createdJobId}`);
    const del = await invoke("deleteScheduledJob", { id: createdJobId }).catch((e) => ({ body: { error: String(e.message) } }));
    console.log(`        deleteScheduledJob: ${JSON.stringify(del.body).slice(0, 200)}`);
  });
