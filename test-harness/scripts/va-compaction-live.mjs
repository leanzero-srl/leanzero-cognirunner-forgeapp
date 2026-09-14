/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * MEMORY COMPACTION, LIVE — F-506 (the backoff), F-507 (the receipt says which) and
 * F-511 (the Agents tab reads BOTH places the engine records it).
 *
 * THE JOURNEY, AND THE DOOR EACH STEP USES.
 *
 *   1. SEED. The agent's notes are pushed over `VA_LIMITS.memoryCompactBytes` (6144) and
 *      under `memoryCapBytes` (8192) — the window compaction exists for. `saveVaMemory`
 *      is DELIBERATELY off the dev hook's `invokeResolver` allow-list and the `kvSet`
 *      allow-list is deliberately NOT widened to `va_memory:*`, so the seed is typed into
 *      the ADMIN PANEL's own Memory pane in a real browser — the door a human has.
 *   2. COMPACT. One prepare tick. The receipt must carry `compacted:{before, after}` with
 *      `after <= 6144`, and the Ticks pane must render the teal
 *      "Memory compacted A to B bytes" line.
 *   3. BREAK THE SUMMARISER. F-506's motivating scenario is a REVOKED BYOK KEY, so that is
 *      what is planted: the instance provider is pointed at a BYOK provider whose key slot
 *      holds a dead value. Both slots are `kvSet`-allow-listed and both are recorded and
 *      REPLAYED at the end.
 *
 *      WHY NOT A BOGUS AGENT-MODEL ID, which is the obvious lever. Because on a Forge-LLM
 *      instance it does not reach compaction at all: `agentCapability`
 *      (src/shared/edition.js:263) refuses any `agentModel` outside
 *      `FORGE_LLM_FRONTIER = ["claude-sonnet-5","claude-opus-5"]` with
 *      `needs-frontier-model`, and the tick refuses at the capability gate long before the
 *      compaction step. It would have produced a capability skip wearing the wrong name.
 *   4. THE LOUD FAILURE. The next tick must answer a `skipped` row `{key:"(memory)",
 *      gate:"compaction", reason:"compaction:…"}`, `ok:false` on the receipt, a live
 *      `va_compact_backoff:{agent}` row, and the RED state in the Ticks pane.
 *   5. THE QUIET ONE. The tick after that must answer `compaction-backoff` with `ok:true`
 *      — the engine deliberately NOT paying for a known-broken call — and make no model
 *      call at all.
 *
 * WHAT THIS SCRIPT CANNOT SEED, AND SAYS SO. The PINNED CONSTRAINTS. `getVaMemory` returns
 * them and `saveVaMemory` accepts them, but the Memory pane renders them READ-ONLY (there
 * is no editor), the resolver is off the hook's allow-list and `va_memory:*` is off the
 * `kvSet` allow-list — so no door outside the engine can create one. The "both pinned
 * lines survive the compaction" half is therefore reported NOT VERIFIED, with its reason,
 * rather than faked with an unpinned line.
 *
 * Usage (from test-harness/):
 *   node scripts/va-compaction-live.mjs --env=staging --flip-model
 *   node scripts/va-compaction-live.mjs --env=staging --flip-model --no-break   # steps 1-2 only
 *
 * Env: STAGING_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 * NOTHING secret is printed — not the trigger URLs, not a key slot's value.
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
const FRONTIER = arg("model", "claude-sonnet-5");
const FLIP_MODEL = flag("flip-model");
const NO_BREAK = flag("no-break");
const KEEP = flag("keep");
const TICK_WAIT_S = Number(arg("tickwait", "300"));

const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const ENV_ID = arg("envid", ENV_ID_DEFAULT);
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";

const COMPACT_BYTES = 6144;   // VA_LIMITS.memoryCompactBytes — asserted against the app below
const AGENT_MODEL_SLOT = "COGNIRUNNER_AGENT_MODEL_atlassian";
const PROVIDER_SLOT = "COGNIRUNNER_AI_PROVIDER";
const BROKEN_PROVIDER = "openai";
const BROKEN_KEY_SLOT = `COGNIRUNNER_KEY_${BROKEN_PROVIDER}`;

/** `undefined` = never touched, so the finally must not write. */
const slotsBefore = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const PASS = (s) => { passes++; console.log(`  PASS  ${s}`); };
const FAIL = (s) => { fails++; console.log(`  FAIL  ${s}`); };
const NV = (s) => { unproven++; console.log(`  N/V   ${s}`); };
const info = (s) => console.log(`        ${s}`);

let createdJobId = null;

/* ── transports ─────────────────────────────────────────────────────────────── */

async function fetchRetry(url, init, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; console.log(`        (transport retry ${i + 1}/${tries}: ${e.message})`); await sleep(2000 * (i + 1)); }
  }
  return { __transportError: last };
}
const readRes = async (res) => {
  if (res && res.__transportError) return { status: 0, body: null, raw: `transport: ${res.__transportError.message}` };
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, body: null, raw: e.message }; }
  let body = null; try { body = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body, raw: body ? null : text.slice(0, 300) };
};
async function hook(body, method = "POST", qs = "") {
  return readRes(await fetchRetry(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
async function kvs(key) {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`);
  if (r.status !== 200 || !r.body) return { ok: false, value: null, status: r.status };
  return { ok: true, value: r.body.value === undefined ? null : r.body.value };
}
async function kvSet(key, value) { return hook({ action: "kvSet", key, value }); }
async function invoke(functionKey, payload = {}, accountId = ADMIN) {
  const r = await hook({ action: "invokeResolver", functionKey, payload, accountId });
  return { status: r.status, body: r.body, raw: r.raw };
}

/* ── the agent ──────────────────────────────────────────────────────────────── */

const PERSONA = "Mira";
const vaRecord = () => ({
  persona: { name: PERSONA, voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: { serviceDesks: [{ serviceDeskId: "1", queueIds: ["1"] }], jql: `project = ${PROJECT}`, mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  // maxItemsPerTick 1 keeps each tick cheap: this run is about the COMPACTION step at the
  // head of the tick, not about the item turns behind it.
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: 500, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 1, maxWritesPerRun: 10 },
  // A 500-tick shadow: this agent must never post to a real person while it is being
  // used as a compaction fixture.
  status: { paused: false, shadowUntilTick: 500 },
});

const receiptsOf = (s) => (s && Array.isArray(s.receipts) ? s.receipts : []);
const latestPrepare = (s) => receiptsOf(s).filter((r) => r.phase === "prepare")[0] || null;
const watchedOf = async (jobId) => {
  const h = await kvs(`va_health:${jobId}`);
  return h.ok && h.value ? Number(h.value.prepareTicks) || 0 : 0;
};

/*
 * WAIT FOR A FRESH FIVE-MINUTE BUCKET BEFORE A TICK THAT MUST BUY A COMPACTION TURN.
 *
 * `tickId` is `${job.id}-${floor(now/300000)}` (src/scheduled-jobs.js:282) and
 * `takeCompactClaim` is keyed by it, so TWO run-nows inside one bucket produce exactly one
 * compaction turn: the second answers `compaction:not_claimed:already_claimed` and never
 * reaches the summariser at all. This script fired its three ticks seconds apart and read
 * that as "the failure arm did not fire" — it was the claim doing its job. Each arm that
 * needs its OWN turn therefore waits for the bucket to roll.
 */
const BUCKET_MS = 300000;
async function waitForFreshBucket(label) {
  const wait = BUCKET_MS - (Date.now() % BUCKET_MS) + 8000;
  info(`${label}: waiting ${Math.round(wait / 1000)}s for the next five-minute tick bucket (the compaction claim is per bucket)`);
  await sleep(wait);
}

/** One prepare tick, waited for by the health counter, then the receipt it produced. */
async function tickOnce(jobId, label, { freshBucket = false } = {}) {
  if (freshBucket) await waitForFreshBucket(label);
  const was = await watchedOf(jobId);
  const ran = await invoke("runScheduledJobNow", { id: jobId });
  if (!(ran.body && ran.body.success)) { FAIL(`${label}: runScheduledJobNow refused: ${JSON.stringify(ran.body).slice(0, 200)}`); return null; }
  const deadline = Date.now() + TICK_WAIT_S * 1000;
  while (Date.now() < deadline) {
    await sleep(6000);
    if ((await watchedOf(jobId)) > was) break;
  }
  if ((await watchedOf(jobId)) <= was) { FAIL(`${label}: va_health.prepareTicks did not move off ${was} within ${TICK_WAIT_S}s`); }
  // The receipt row lands with the health bump; give the status read a beat to see it.
  await sleep(4000);
  const st = (await invoke("getVaStatus", { jobId })).body;
  return { st, receipt: latestPrepare(st) };
}

/* ── the admin panel: the seed door, and the two states of the Ticks pane ────── */

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
    if (!frame) throw new Error("the admin panel iframe never appeared — is the persistent profile still signed in?");
    await frame.locator(".tab-btn", { hasText: /^\s*Agents\s*$/ }).click();
    const card = frame.locator(".va-agent").filter({ has: frame.locator(".va-agent-name", { hasText: PERSONA }) }).first();
    await card.waitFor({ state: "visible", timeout: 60000 });
    return await fn({ frame, card });
  } finally { await ctx.close(); }
}

const openPane = async (card, label) => {
  if (!(await card.locator(".va-detail").isVisible().catch(() => false))) {
    await card.locator(".rule-expand-btn").first().click();
  }
  await card.locator(".va-pane-btn", { hasText: new RegExp(`^${label}$`) }).click();
  await sleep(1500);
};

/* ── the journey ────────────────────────────────────────────────────────────── */

async function main() {
  console.log(`\nMEMORY COMPACTION — live on ${ENV_NAME.toUpperCase()} (F-506 / F-507 / F-511)\n`);
  if (!HOOK_URL) throw new Error(`no web-trigger URL configured for environment "${ENV_NAME}"`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable / the secret was rejected (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  /* ── STEP 0 — the model, and an agent that can never speak ───────────────── */
  if (FLIP_MODEL) {
    const slot = await kvs(AGENT_MODEL_SLOT);
    slotsBefore[AGENT_MODEL_SLOT] = slot.value;
    info(`${AGENT_MODEL_SLOT} before: ${slot.value === null ? "EMPTY (the resolver answers a fallback)" : JSON.stringify(slot.value)}`);
    const set = await invoke("saveAgentModel", { model: FRONTIER });
    if (set.body && set.body.success) PASS(`agent model flipped to "${FRONTIER}"`);
    else FAIL(`saveAgentModel("${FRONTIER}") refused: ${JSON.stringify(set.body).slice(0, 300)}`);
  }
  const cap = (await invoke("getAgentCapability", {})).body || {};
  info(`getAgentCapability -> enabled=${cap.enabled} reason="${cap.reason}" provider=${cap.provider} agentModel=${cap.agentModel}`);
  if (cap.enabled !== true) { FAIL(`the instance cannot hold an agent (${cap.reason})`); return; }

  console.log("\nSTEP 0 — create the fixture agent (500 shadow ticks: it must never post)");
  const created = await invoke("saveScheduledJob", { job: { name: `Compaction proof ${Date.now().toString(36)}`, mode: "va", enabled: true, va: vaRecord() } });
  if (!(created.body && created.body.success)) { FAIL(`saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 400)}`); return; }
  const jobId = created.body.job.id;
  createdJobId = jobId;
  PASS(`agent created: ${jobId} shadowUntilTick=${created.body.job.va.status.shadowUntilTick}`);

  /* ── STEP 1 — the seed, through the Memory pane ──────────────────────────── */
  console.log("\nSTEP 1 — seed the notes ABOVE the compaction threshold, through the admin panel's Memory pane");
  const memRead = await invoke("getVaMemory", { jobId });
  info(`getVaMemory before: ${JSON.stringify(memRead.body).slice(0, 200)}`);
  const capBytes = (memRead.body && memRead.body.capBytes) || 8192;
  info(`the app reports capBytes=${capBytes}; the compaction threshold this run asserts against is ${COMPACT_BYTES}`);
  // Plain ASCII lines, no characters JSON has to escape, so the byte count the browser
  // shows and the byte count `memoryBytes` measures differ only by the envelope.
  const lines = [];
  for (let i = 1; lines.join("\n").length < 6800; i++) {
    lines.push(`Note ${i}: the requester on this queue answers within a working day and prefers a short reply naming the ticket and the next step, so keep it to two sentences and never restate the question back to them.`);
  }
  const SEED = lines.join("\n");
  info(`seeding ${new TextEncoder().encode(SEED).length} bytes of unpinned prose in ${lines.length} lines`);
  const seeded = await withAgentsTab(async ({ card }) => {
    await openPane(card, "Memory");
    const ta = card.locator("textarea.va-memory");
    await ta.waitFor({ state: "visible", timeout: 30000 });
    await ta.fill(SEED);
    const count = (await card.locator(".va-memory-count").innerText()).trim();
    const btn = card.locator("button", { hasText: /^(Save memory|Saving…)$/ });
    const disabled = await btn.isDisabled();
    if (disabled) return { error: `the Save memory button is disabled at ${count} — the seed does not fit under the cap`, count };
    await btn.click();
    await sleep(4000);
    const constraints = await card.locator(".va-constraint").allInnerTexts().catch(() => []);
    return { count, constraints };
  }).catch((e) => ({ error: String((e && e.message) || e).slice(0, 250) }));
  if (seeded.error) { FAIL(`the memory could not be seeded through the admin panel: ${seeded.error}`); return; }
  info(`the Memory pane's own byte counter reads: ${seeded.count}`);

  const after = await invoke("getVaMemory", { jobId });
  const storedText = (after.body && after.body.memory) || "";
  const storedBytes = new TextEncoder().encode(storedText).length;
  info(`getVaMemory after the seed: ${storedBytes} bytes of text, ${((after.body && after.body.constraints) || []).length} pinned constraint(s)`);
  if (storedBytes > COMPACT_BYTES) PASS(`the notes are stored ABOVE the ${COMPACT_BYTES}-byte compaction threshold (${storedBytes} bytes) — the next tick has something to compact`);
  else { FAIL(`the notes are only ${storedBytes} bytes, at or under the ${COMPACT_BYTES} threshold — nothing below would run`); return; }
  NV("the PINNED CONSTRAINTS half is not seeded: `saveVaMemory` is off the dev hook's invokeResolver allow-list, `va_memory:*` is off the kvSet allow-list, and the Memory pane renders constraints READ-ONLY (there is no editor) — so no door outside the engine can create one, and \"both pinned lines survive\" stays UNPROVEN rather than being faked with an unpinned line.");

  /* ── STEP 2 — the compaction that WORKS ──────────────────────────────────── */
  console.log("\nSTEP 2 — one prepare tick: the compaction turn");
  const t1 = await tickOnce(jobId, "compaction tick", { freshBucket: true });
  const r1 = t1 && t1.receipt;
  info(`receipt: ${JSON.stringify(r1).slice(0, 700)}`);
  const c1 = r1 && r1.compacted;
  if (c1 && typeof c1 === "object") {
    PASS(`the receipt carries compacted:{before:${c1.before}, after:${c1.after}} — the field is present ONLY when a turn actually ran`);
    if (Number(c1.before) > COMPACT_BYTES) PASS(`before (${c1.before}) is above the threshold, as the seed intended`);
    else FAIL(`before is ${c1.before}, not above ${COMPACT_BYTES}`);
    if (Number(c1.after) <= COMPACT_BYTES) PASS(`after (${c1.after}) is at or under ${COMPACT_BYTES} — it CONVERGED`);
    else FAIL(`after is ${c1.after}, still over the ${COMPACT_BYTES} budget`);
    if (c1.fellBack !== true) PASS("fellBack is not true — the summariser answered, the notes were summarised and not bluntly cut");
    else FAIL("the compaction FELL BACK: the notes were cut instead of summarised");
  } else {
    FAIL(`the receipt carries no compacted{} block: ${JSON.stringify(r1).slice(0, 400)}`);
  }
  if (r1 && r1.ok !== false) PASS("the tick is ok — a compaction that converged does not fail the tick");
  else FAIL(`the tick is marked failed: ${JSON.stringify(r1 && r1.skipped)}`);
  const memAfter = await invoke("getVaMemory", { jobId });
  const bytesAfter = new TextEncoder().encode((memAfter.body && memAfter.body.memory) || "").length;
  info(`getVaMemory after the compaction: ${bytesAfter} bytes (was ${storedBytes}) — the SECOND read, through the resolver rather than the receipt`);
  if (bytesAfter < storedBytes) PASS("the stored notes really did shrink — the receipt's numbers are backed by the row");
  else FAIL(`the stored notes did not shrink (${storedBytes} -> ${bytesAfter}) — the receipt and the row disagree`);
  const boNow = await kvs(`va_compact_backoff:${jobId}`);
  if (boNow.ok && boNow.value === null) PASS("no va_compact_backoff row after a converged compaction — the brake is not armed on success");
  else FAIL(`va_compact_backoff exists after a SUCCESSFUL compaction: ${JSON.stringify(boNow.value)}`);

  const ui1 = await withAgentsTab(async ({ card }) => {
    await openPane(card, "Ticks");
    const rows = await card.locator(".va-receipt-compact").allInnerTexts().catch(() => []);
    const bad = await card.locator(".va-receipt-compact-bad").count();
    return { rows, bad };
  }).catch((e) => ({ error: String((e && e.message) || e).slice(0, 200) }));
  if (ui1.error) NV(`the Ticks pane could not be read (${ui1.error})`);
  else {
    info(`Ticks pane compaction lines: ${JSON.stringify(ui1.rows)} (red rows: ${ui1.bad})`);
    if (ui1.rows.some((t) => /Memory compacted \d+.*to .*bytes/i.test(t.replace(/\n/g, " ")))) PASS('the Agents tab renders the teal "Memory compacted A to B bytes" line (F-511)');
    else FAIL(`the Agents tab shows no "Memory compacted" line: ${JSON.stringify(ui1.rows)}`);
    if (ui1.bad === 0) PASS("and no red compaction row — a success is not painted as a failure");
    else FAIL(`${ui1.bad} RED compaction row(s) on a successful compaction`);
  }

  if (NO_BREAK) { console.log("\n--no-break: stopping before the failure arms."); return; }

  /* ── STEP 3 — break the summariser the way a customer breaks it ──────────── */
  console.log("\nSTEP 3 — plant a DEAD BYOK credential (F-506's own scenario) and re-seed the notes");
  for (const k of [PROVIDER_SLOT, BROKEN_KEY_SLOT]) {
    const s = await kvs(k);
    slotsBefore[k] = s.value;
    info(`${k} before: ${s.value === null ? "EMPTY" : "(a value is present — not printed)"}`);
  }
  await kvSet(PROVIDER_SLOT, BROKEN_PROVIDER);
  await kvSet(BROKEN_KEY_SLOT, "sk-harness-deliberately-dead-key-000000000000000000");
  const prov = await kvs(PROVIDER_SLOT);
  if (prov.ok && prov.value === BROKEN_PROVIDER) PASS(`the instance provider is now "${BROKEN_PROVIDER}" with a dead key — every model call on this instance will fail until the finally replays both slots`);
  else FAIL(`the provider slot did not take: ${JSON.stringify(prov.value)}`);
  // The provider/key config is TTL-cached ~30s in index.js; the consumer does not cache.
  await sleep(35000);

  const seeded2 = await withAgentsTab(async ({ card }) => {
    await openPane(card, "Memory");
    const ta = card.locator("textarea.va-memory");
    await ta.waitFor({ state: "visible", timeout: 30000 });
    await ta.fill(SEED);
    const btn = card.locator("button", { hasText: /^(Save memory|Saving…)$/ });
    if (await btn.isDisabled()) return { error: "the Save memory button is disabled" };
    await btn.click();
    await sleep(4000);
    return { ok: true };
  }).catch((e) => ({ error: String((e && e.message) || e).slice(0, 200) }));
  if (seeded2.error) { FAIL(`the notes could not be re-seeded: ${seeded2.error}`); return; }
  const re = await invoke("getVaMemory", { jobId });
  const reBytes = new TextEncoder().encode((re.body && re.body.memory) || "").length;
  if (reBytes > COMPACT_BYTES) PASS(`the notes are over the threshold again (${reBytes} bytes) — the next tick must try to compact`);
  else { FAIL(`the re-seed is only ${reBytes} bytes`); return; }

  /* ── STEP 4 — the LOUD failure ───────────────────────────────────────────── */
  console.log("\nSTEP 4 — the tick that PAYS for a dead summariser: loud, gated, and braked");
  const t2 = await tickOnce(jobId, "failing tick", { freshBucket: true });
  const r2 = t2 && t2.receipt;
  info(`receipt: ${JSON.stringify(r2).slice(0, 800)}`);
  const skips2 = (r2 && Array.isArray(r2.skipped) ? r2.skipped : []);
  const memSkip = skips2.find((s) => s.key === "(memory)" || /^compaction:/.test(String(s.reason || "")));
  if (memSkip) {
    PASS(`the receipt carries the memory skip row: ${JSON.stringify(memSkip)}`);
    if (memSkip.gate === "compaction") PASS('the row names the GATE: gate:"compaction" — a paid-for failure, not housekeeping');
    else FAIL(`the row has no gate:"compaction": ${JSON.stringify(memSkip)}`);
    if (/^compaction:/.test(String(memSkip.reason || ""))) PASS(`the reason is namespaced: "${memSkip.reason}" (F-507 — the receipt says WHICH failure)`);
    else FAIL(`the reason is not namespaced "compaction:…": ${JSON.stringify(memSkip.reason)}`);
  } else {
    FAIL(`no memory skip row on the receipt: ${JSON.stringify(skips2).slice(0, 400)}`);
  }
  if (r2 && r2.ok === false) PASS("the tick is marked ok:false — a compaction that was PAID FOR and did not converge fails the tick (F-506)");
  else FAIL(`the tick is ok=${r2 && r2.ok} after a paid-for failed compaction`);
  const bo2 = await kvs(`va_compact_backoff:${jobId}`);
  if (bo2.ok && bo2.value !== null) PASS(`va_compact_backoff is ARMED: ${JSON.stringify(bo2.value).slice(0, 200)}`);
  else FAIL(`va_compact_backoff was NOT armed after the failure: ${JSON.stringify(bo2.value)}`);

  const ui2 = await withAgentsTab(async ({ card }) => {
    await openPane(card, "Ticks");
    const bad = await card.locator(".va-receipt-compact-bad").allInnerTexts().catch(() => []);
    const failed = await card.locator(".va-receipt-failed").count();
    return { bad, failed };
  }).catch((e) => ({ error: String((e && e.message) || e).slice(0, 200) }));
  if (ui2.error) NV(`the Ticks pane could not be read (${ui2.error})`);
  else {
    info(`red compaction rows: ${JSON.stringify(ui2.bad)}; FAILED markers: ${ui2.failed}`);
    if (ui2.bad.some((t) => /Memory compaction failed/i.test(t))) PASS('the Agents tab shows the RED "Memory compaction failed" state with a sentence (F-511)');
    else FAIL(`the Agents tab shows no red compaction row: ${JSON.stringify(ui2.bad)}`);
    if (ui2.failed >= 1) PASS("and the receipt itself is marked FAILED in the tab");
    else FAIL("the tab does not mark the receipt FAILED");
  }

  /* ── STEP 5 — the QUIET one ──────────────────────────────────────────────── */
  /*
   * RE-SEED FIRST, AND THIS IS NOT A CONVENIENCE. The FALLBACK clamp wrote 6142 bytes —
   * two bytes under the 6144 threshold, by construction — so the tick after the failure
   * answers `under_threshold` and never consults the backoff at all. A run without this
   * re-seed reports "no compaction-backoff row" and the reader cannot tell that from the
   * brake being broken. Pushing the notes back over the threshold is the only way to ask
   * the question the backoff exists to answer. `saveVaMemory` calls no model, so it still
   * works with the dead credential planted.
   */
  console.log("\nSTEP 5 — the next tick must NOT buy the same dead call again");
  const seeded3 = await withAgentsTab(async ({ card }) => {
    await openPane(card, "Memory");
    const ta = card.locator("textarea.va-memory");
    await ta.waitFor({ state: "visible", timeout: 30000 });
    await ta.fill(SEED);
    const btn = card.locator("button", { hasText: /^(Save memory|Saving…)$/ });
    if (await btn.isDisabled()) return { error: "the Save memory button is disabled" };
    await btn.click();
    await sleep(4000);
    return { ok: true };
  }).catch((e) => ({ error: String((e && e.message) || e).slice(0, 200) }));
  const re3 = await invoke("getVaMemory", { jobId });
  const re3Bytes = new TextEncoder().encode((re3.body && re3.body.memory) || "").length;
  if (seeded3.error || re3Bytes <= COMPACT_BYTES) {
    FAIL(`the notes could not be pushed back over the threshold before the backoff tick (${seeded3.error || re3Bytes + " bytes"}) — the backoff arm cannot be judged`);
    return;
  }
  PASS(`the notes are over the threshold again (${re3Bytes} bytes), so this tick HAS something to compact — the only way the backoff can be the reason it does not`);
  const t3 = await tickOnce(jobId, "backoff tick", { freshBucket: true });
  const r3 = t3 && t3.receipt;
  info(`receipt: ${JSON.stringify(r3).slice(0, 700)}`);
  const skips3 = (r3 && Array.isArray(r3.skipped) ? r3.skipped : []);
  const boSkip = skips3.find((s) => /compaction-backoff/.test(String(s.reason || "")));
  if (boSkip) PASS(`the tick answers the backoff by name: ${JSON.stringify(boSkip)}`);
  else FAIL(`no compaction-backoff row on the tick after the failure: ${JSON.stringify(skips3).slice(0, 400)}`);
  if (r3 && r3.ok !== false) PASS("and the tick is ok:true — the engine deliberately not paying for a known-broken call is not a failed tick, and marking it one would bury the banner it already raised");
  else FAIL(`the backoff tick is marked ok:false: ${JSON.stringify(r3 && r3.skipped)}`);
  if (!(r3 && r3.compacted)) PASS("no compacted{} block on the backoff tick — absent means 'no turn was bought', which is exactly what a backoff is");
  else FAIL(`the backoff tick carries a compacted block, so a turn WAS bought: ${JSON.stringify(r3.compacted)}`);
  info("whether a model call was made is asserted from `forge logs -e staging` after this run, not from here.");
}

main()
  .catch((e) => { console.error("\nDRIVER ERROR:", e && e.stack); process.exitCode = 1; })
  .finally(async () => {
    const left = [];
    /* THE SLOTS COME BACK FIRST — an instance left pointing at a dead provider is the
       worst thing this script can leave behind, worse than a stray agent. */
    for (const [k, v] of Object.entries(slotsBefore)) {
      if (v === undefined) continue;
      await kvSet(k, v);
      const back = await kvs(k);
      const ok = !!(back.ok && JSON.stringify(back.value) === JSON.stringify(v));
      console.log(`        ${ok ? "RESTORED" : "NOT RESTORED"}: ${k} (value not printed)`);
      if (!ok) left.push(`${k} was not restored`);
    }
    if (createdJobId && !KEEP) {
      await invoke("deleteScheduledJob", { id: createdJobId }).catch(() => null);
      const back = await invoke("getScheduledJob", { id: createdJobId }).catch(() => null);
      const survives = !!(back && back.body && back.body.job);
      console.log(`        second read getScheduledJob ${createdJobId}: ${survives ? "STILL PRESENT" : "gone"}`);
      if (survives) left.push(`the Virtual Administrator ${createdJobId} is still on the instance`);
      const bo = await kvs(`va_compact_backoff:${createdJobId}`).catch(() => ({ ok: false }));
      console.log(`        va_compact_backoff:${createdJobId} after the delete: ${bo.ok ? (bo.value === null ? "gone" : "STILL PRESENT") : "unreadable"}`);
      if (bo.ok && bo.value !== null) left.push(`va_compact_backoff:${createdJobId} survived the delete`);
    }
    console.log(`\nRESULT — ${passes} pass, ${fails} fail, ${unproven} not verified`);
    if (left.length) { console.error(`\nCLEANUP FAILED — ${left.join("; ")}`); process.exitCode = 1; }
    if (fails) process.exitCode = 1;
  });
