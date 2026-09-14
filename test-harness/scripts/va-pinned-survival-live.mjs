/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * DO THE PINNED CONSTRAINTS SURVIVE A COMPACTION — asked live, on staging.
 *
 * `va-compaction-live.mjs` reports this half NOT VERIFIED, and correctly: no door outside
 * the engine can CREATE a pinned constraint. `saveVaMemory` is off the dev hook's
 * allow-list, `va_memory:*` is off the `kvSet` allow-list, and the Memory pane renders
 * constraints read-only.
 *
 * THE ONE DOOR THAT REMAINS IS THE ENGINE'S OWN. The agent pins a constraint by calling
 * `memory_note({note, constraint:true})` during an item turn — observed live on staging at
 * 2026-09-13T16:30:30Z. So this script does not plant a constraint: it lets the agent earn
 * one, checks that it is there, pushes the UNPINNED prose back over the 6144-byte
 * threshold through the Memory pane (which re-sends the constraints it read, so they ride
 * along untouched), and then asks whether the compaction turn left every pinned line
 * byte-for-byte intact.
 *
 * IT CAN LEGITIMATELY COME BACK UNPROVEN, and says so rather than passing: whether the
 * agent pins anything on a given turn is the MODEL's judgement, not a guarantee. A run
 * that earns no constraint reports exactly that.
 *
 * Usage:  node scripts/va-pinned-survival-live.mjs --env=staging --flip-model
 */

import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { loadEnv, requireEnv } from "../lib/env.mjs";

const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["agents", "jobs", "memories", "providerSlot"], defaultEnv: "staging" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);

const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "JT");
const FLIP_MODEL = flag("flip-model");
const FRONTIER = arg("model", "claude-sonnet-5");
const TICK_WAIT_S = Number(arg("tickwait", "300"));
const TURN_WAIT_S = Number(arg("turnwait", "180"));

const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const ENV_ID = arg("envid", ENV_ID_DEFAULT);
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const COMPACT_BYTES = 6144;
const AGENT_MODEL_SLOT = "COGNIRUNNER_AGENT_MODEL_atlassian";
const PERSONA = "Pin";
const BUCKET_MS = 300000;

let slotBefore;
let createdJobId = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const PASS = (s) => { passes++; console.log(`  PASS  ${s}`); };
const FAIL = (s) => { fails++; console.log(`  FAIL  ${s}`); };
const NV = (s) => { unproven++; console.log(`  N/V   ${s}`); };
const info = (s) => console.log(`        ${s}`);

const readRes = async (res) => {
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, body: null }; }
  let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: res.status, body, raw: body ? null : text.slice(0, 200) };
};
async function hook(body, method = "POST", qs = "") {
  return readRes(await fetch(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
async function kvs(key) {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`);
  if (r.status !== 200 || !r.body) return { ok: false, value: null };
  return { ok: true, value: r.body.value === undefined ? null : r.body.value };
}
const invoke = async (functionKey, payload = {}) => hook({ action: "invokeResolver", functionKey, payload, accountId: ADMIN });

const vaRecord = () => ({
  persona: { name: PERSONA, voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: { serviceDesks: [{ serviceDeskId: "1", queueIds: ["1"] }], jql: `project = ${PROJECT}`, mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: 500, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 3, maxWritesPerRun: 10 },
  status: { paused: false, shadowUntilTick: 500 },
});

const watchedOf = async (jobId) => {
  const h = await kvs(`va_health:${jobId}`);
  return h.ok && h.value ? Number(h.value.prepareTicks) || 0 : 0;
};
const latestPrepare = (s) => (s && Array.isArray(s.receipts) ? s.receipts : []).filter((r) => r.phase === "prepare")[0] || null;

/** The compaction claim is per five-minute bucket — a tick that must buy a turn waits. */
async function freshBucket(label) {
  const wait = BUCKET_MS - (Date.now() % BUCKET_MS) + 8000;
  info(`${label}: waiting ${Math.round(wait / 1000)}s for the next five-minute tick bucket`);
  await sleep(wait);
}
async function tickOnce(jobId, label, wantBucket = true) {
  if (wantBucket) await freshBucket(label);
  const was = await watchedOf(jobId);
  const ran = await invoke("runScheduledJobNow", { id: jobId });
  if (!(ran.body && ran.body.success)) { FAIL(`${label}: runScheduledJobNow refused`); return null; }
  const deadline = Date.now() + TICK_WAIT_S * 1000;
  while (Date.now() < deadline) { await sleep(6000); if ((await watchedOf(jobId)) > was) break; }
  await sleep(4000);
  const st = (await invoke("getVaStatus", { jobId })).body;
  return { st, receipt: latestPrepare(st) };
}

async function withAgentsTab(fn) {
  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 1400 } });
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
    await frame.locator(".tab-btn", { hasText: /^\s*Agents\s*$/ }).click();
    const card = frame.locator(".va-agent").filter({ has: frame.locator(".va-agent-name", { hasText: PERSONA }) }).first();
    await card.waitFor({ state: "visible", timeout: 60000 });
    return await fn({ frame, card });
  } finally { await ctx.close(); }
}
const openPane = async (card, label) => {
  if (!(await card.locator(".va-detail").isVisible().catch(() => false))) await card.locator(".rule-expand-btn").first().click();
  await card.locator(".va-pane-btn", { hasText: new RegExp(`^${label}$`) }).click();
  await sleep(1500);
};

async function main() {
  console.log("\nPINNED CONSTRAINTS vs COMPACTION — live on staging\n");
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`hook unreachable (${ping.status})`);
  PASS("hook reachable, secret accepted");
  if (FLIP_MODEL) {
    slotBefore = (await kvs(AGENT_MODEL_SLOT)).value;
    await invoke("saveAgentModel", { model: FRONTIER });
    PASS(`agent model flipped to "${FRONTIER}" (slot replayed in the finally)`);
  }
  const created = await invoke("saveScheduledJob", { job: { name: `Pinned survival ${Date.now().toString(36)}`, mode: "va", enabled: true, va: vaRecord() } });
  if (!(created.body && created.body.success)) { FAIL(`saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 300)}`); return; }
  const jobId = created.body.job.id;
  createdJobId = jobId;
  PASS(`agent created: ${jobId} (500 shadow ticks — it can never post)`);

  /* ── STEP 1 — let the agent EARN a pinned constraint ─────────────────────── */
  console.log("\nSTEP 1 — one tick, and see whether the agent pins anything of its own accord");
  await tickOnce(jobId, "earning tick", false);
  let pinned = [];
  const deadline = Date.now() + TURN_WAIT_S * 1000;
  while (Date.now() < deadline) {
    const m = await invoke("getVaMemory", { jobId });
    pinned = (m.body && m.body.constraints) || [];
    if (pinned.length) break;
    await sleep(10000);
  }
  if (!pinned.length) {
    NV(`the agent pinned nothing on this turn, so the survival question cannot be asked. Whether a turn calls memory_note({constraint:true}) is the MODEL's judgement, not a guarantee — re-run, or drive it from a turn that has something worth pinning.`);
    return;
  }
  PASS(`the agent pinned ${pinned.length} constraint(s) through its own memory_note(constraint:true)`);
  const before = pinned.map((c) => (typeof c === "string" ? c : c.text));
  before.forEach((t, i) => info(`  pinned[${i}]: ${JSON.stringify(String(t).slice(0, 140))}`));

  /* ── STEP 2 — push the UNPINNED prose over the threshold, pins riding along ─ */
  console.log("\nSTEP 2 — push the unpinned prose over 6144 bytes through the Memory pane");
  const lines = [];
  for (let i = 1; lines.join("\n").length < 6600; i++) {
    lines.push(`Note ${i}: this queue answers within a working day and prefers a short reply naming the ticket and the next step, so keep it to two sentences and never restate the question back to the reporter.`);
  }
  const SEED = lines.join("\n");
  const seeded = await withAgentsTab(async ({ card }) => {
    await openPane(card, "Memory");
    const shown = await card.locator(".va-constraint").allInnerTexts().catch(() => []);
    const ta = card.locator("textarea.va-memory");
    await ta.waitFor({ state: "visible", timeout: 30000 });
    await ta.fill(SEED);
    const btn = card.locator("button", { hasText: /^(Save memory|Saving…)$/ });
    if (await btn.isDisabled()) return { error: "the Save memory button is disabled" };
    await btn.click();
    await sleep(4000);
    return { shown };
  }).catch((e) => ({ error: String((e && e.message) || e).slice(0, 200) }));
  if (seeded.error) { FAIL(`could not seed: ${seeded.error}`); return; }
  info(`the Memory pane displayed ${seeded.shown.length} pinned constraint(s) while saving`);
  const mid = await invoke("getVaMemory", { jobId });
  const midPins = ((mid.body && mid.body.constraints) || []).map((c) => (typeof c === "string" ? c : c.text));
  const midBytes = new TextEncoder().encode((mid.body && mid.body.memory) || "").length;
  info(`after the seed: ${midBytes} bytes of prose, ${midPins.length} pinned`);
  if (midBytes > COMPACT_BYTES) PASS(`the notes are over the ${COMPACT_BYTES}-byte threshold (${midBytes}) — the next tick must compact`);
  else { FAIL(`only ${midBytes} bytes`); return; }
  if (JSON.stringify(midPins) === JSON.stringify(before)) PASS("the pins survived the SAVE unchanged — the pane re-sends what it read, it does not drop them");
  else { FAIL(`the save changed the pins: ${JSON.stringify(before)} -> ${JSON.stringify(midPins)}`); return; }

  /* ── STEP 3 — compact, and read the pins back ────────────────────────────── */
  console.log("\nSTEP 3 — the compaction turn, and the pins afterwards");
  const t = await tickOnce(jobId, "compaction tick");
  const r = t && t.receipt;
  info(`receipt.compacted: ${JSON.stringify(r && r.compacted)}`);
  const c = r && r.compacted;
  if (c && Number(c.after) <= COMPACT_BYTES && c.fellBack !== true) PASS(`the compaction ran and converged: ${c.before} -> ${c.after} bytes`);
  else { FAIL(`the compaction did not converge cleanly: ${JSON.stringify(c)}`); return; }
  const after = await invoke("getVaMemory", { jobId });
  const afterPins = ((after.body && after.body.constraints) || []).map((cc) => (typeof cc === "string" ? cc : cc.text));
  info(`after the compaction: ${new TextEncoder().encode((after.body && after.body.memory) || "").length} bytes of prose, ${afterPins.length} pinned`);
  afterPins.forEach((t2, i) => info(`  pinned[${i}]: ${JSON.stringify(String(t2).slice(0, 140))}`));
  const missing = before.filter((b) => !afterPins.includes(b));
  if (!missing.length) PASS(`EVERY pinned line is present byte-for-byte after the compaction (${before.length}/${before.length}) — the summariser is not trusted with them, they are carried across by code (F-423)`);
  else FAIL(`${missing.length} pinned line(s) were LOST: ${JSON.stringify(missing.map((m) => String(m).slice(0, 80)))}`);
}

main()
  .catch((e) => { console.error("\nDRIVER ERROR:", e && e.stack); process.exitCode = 1; })
  .finally(async () => {
    const left = [];
    if (createdJobId) {
      await invoke("deleteScheduledJob", { id: createdJobId }).catch(() => null);
      const back = await invoke("getScheduledJob", { id: createdJobId }).catch(() => null);
      const survives = !!(back && back.body && back.body.job);
      console.log(`        second read getScheduledJob ${createdJobId}: ${survives ? "STILL PRESENT" : "gone"}`);
      if (survives) left.push(`the agent ${createdJobId} is still on the instance`);
    }
    if (slotBefore !== undefined) {
      await hook({ action: "kvSet", key: AGENT_MODEL_SLOT, value: slotBefore });
      const b = await kvs(AGENT_MODEL_SLOT);
      const ok = JSON.stringify(b.value) === JSON.stringify(slotBefore);
      console.log(`        ${ok ? "RESTORED" : "NOT RESTORED"}: ${AGENT_MODEL_SLOT}`);
      if (!ok) left.push(`${AGENT_MODEL_SLOT} not restored`);
    }
    console.log(`\nRESULT — ${passes} pass, ${fails} fail, ${unproven} not verified`);
    if (left.length) { console.error(`\nCLEANUP FAILED — ${left.join("; ")}`); process.exitCode = 1; }
    if (fails) process.exitCode = 1;
  });
