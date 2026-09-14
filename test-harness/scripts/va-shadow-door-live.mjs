/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE SHADOW DOOR, LIVE — F-508 (the ceiling REPORTS, it never silently shortens),
 * F-514 (one ceiling, both doors) and the F-519-shaped question about the shadow
 * window itself.
 *
 * WHAT IT ASKS, IN ORDER, AND OF WHOM.
 *
 *   1. Shadow ENDS on its own terms. An agent saved with `shadowTicks: 3` is watched for
 *      exactly three of ITS OWN prepare receipts (F-484's unit), so the fourth tick finds
 *      it live. Four run-now ticks are fired, each one waited for by RECEIPT COUNT — not
 *      by a sleep — and `getVaStatus().shadow` is read after each.
 *   2. A watch nobody can honour is SAID, not cut. `PUT ?resource=agents
 *      {va:{status:{shadowUntilTick:500}}}` must STORE 500 and answer with a `refused[]`/
 *      `notes[]` row naming the reachability. The old build answered 200 with 6 and an
 *      empty `refused[]` — the defect F-508 is: ~497 ticks earlier than the admin was
 *      told, the agent went live and started posting to customers.
 *   3. A value that is not a watch at all is CLAMPED, with a report. `50000` is above
 *      `VA_CEILINGS.shadowUntilTick.max`, so it comes back as the ceiling and the answer
 *      says so.
 *   4. THE ADMIN'S OWN EYES. The Agents tab is opened in a real browser for the 500 case
 *      and the SHADOW badge and its "N ticks left" line are read off the DOM. A field in
 *      a JSON body is not what the admin sees.
 *   5. THE PURGE. The agent is deleted and every row it could have left is proven ABSENT
 *      by a second read — `va_index`, `va_health`, `va_memory`, `va_item:*` and
 *      `va_compact_backoff` — each one preceded by the same read SEEING something, so an
 *      absence is evidence and not a broken query.
 *
 * WHICH DOORS THIS USES AND WHY. `runVaTickNow`, `pauseVa` and `saveVaMemory` are
 * DELIBERATELY off the dev hook's `invokeResolver` allow-list, so the tick is driven
 * through `runScheduledJobNow` (which branches on `isVaJob` and pushes the IDENTICAL
 * `va-tick` task) and the shadow field is written through the REST door the finding is
 * actually about. Every substitution is named in the output.
 *
 * STAGING ONLY, in practice: since F-485 an instance whose agent capability is off cannot
 * hold a VA at all, and DEV's is. `--flip-model` points the agent model at a frontier
 * model for the run and REPLAYS THE KVS SLOT afterwards (the resolver answers a fallback
 * when the slot is empty, so restoring "what the resolver said" would leave it dirty).
 *
 * Usage (from test-harness/):
 *   node scripts/va-shadow-door-live.mjs --env=staging --flip-model
 *   node scripts/va-shadow-door-live.mjs --env=staging --flip-model --no-ui   # skip Playwright
 *
 * Env: STAGING_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 * NOTHING secret is printed — not the trigger URLs, not the bearer token.
 */

import { requireEnvAck, forgeEnvId } from "../lib/shared-env-guard.mjs";
import { loadEnv, requireEnv } from "../lib/env.mjs";

const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["agents", "jobs", "providerSlot", "kvs"], defaultEnv: "staging" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);

const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "JT");
const FRONTIER = arg("model", "claude-sonnet-5");
const FLIP_MODEL = flag("flip-model");
const NO_UI = flag("no-ui");
const KEEP = flag("keep");
const TICK_WAIT_S = Number(arg("tickwait", "240"));
const SHADOW_TICKS = 3;

/* The staging admin panel, for the one question only a browser can answer. */
const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const STAGING_ENV = arg("envid", forgeEnvId("staging"));
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";

/* The slot, and the rule the restore follows — see va-rest-doors-live.mjs's note. */
const AGENT_MODEL_SLOT = "COGNIRUNNER_AGENT_MODEL_atlassian";
let agentModelSlotBefore;      // `undefined` = never touched, so the finally must not write

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const PASS = (s) => { passes++; console.log(`  PASS  ${s}`); };
const FAIL = (s) => { fails++; console.log(`  FAIL  ${s}`); };
const NV = (s) => { unproven++; console.log(`  N/V   ${s}`); };
const info = (s) => console.log(`        ${s}`);

let createdJobId = null;
const cleanupTokens = [];

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
/** ONE KVS row through the hook's unrestricted GET read. `{ok:false}` = could not read. */
async function kvs(key) {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`);
  if (r.status !== 200 || !r.body) return { ok: false, value: null, status: r.status };
  return { ok: true, value: r.body.value === undefined ? null : r.body.value };
}
async function invoke(functionKey, payload = {}, accountId = ADMIN) {
  const r = await hook({ action: "invokeResolver", functionKey, payload, accountId });
  return { status: r.status, body: r.body, raw: r.raw };
}
let RULES_URL = null;
async function rest(token, method, query, body) {
  const qs = Object.entries(query).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return readRes(await fetchRetry(`${RULES_URL}?${qs}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

/* ── the agent under test ───────────────────────────────────────────────────── */

const vaRecord = () => ({
  persona: { name: "Nadia", voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: { serviceDesks: [{ serviceDeskId: "1", queueIds: ["1", "2", "3"] }], jql: `project = ${PROJECT}`, mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  // replyInternal only — the agent has no outward act but a staged internal note, and it
  // never leaves shadow long enough to take it.
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: SHADOW_TICKS, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 5, maxWritesPerRun: 10 },
  status: { paused: false, shadowUntilTick: SHADOW_TICKS },
});

const receiptsOf = (s) => (s && Array.isArray(s.receipts) ? s.receipts : []);

/*
 * THE UNIT OF "WATCHED" IS `va_health:{agent}.prepareTicks`, NOT THE RECEIPT LIST.
 *
 * This script first counted `getVaStatus().receipts.filter(phase==="prepare").length` and
 * reported a false failure with it. Two run-nows inside the same five-minute window share
 * the scheduler's bucket `tickId`, so they land on ONE receipt row — while the health
 * counter, which is what `watchedTicks` (src/virtual-admin.js) reads and what the post
 * gate compares `shadowUntilTick` against, advances on each. Measuring the wrong counter
 * made a correct engine look like it left shadow a tick early. The counter the GATE reads
 * is the counter the test reads.
 */
const watchedOf = async (jobId) => {
  const h = await kvs(`va_health:${jobId}`);
  return h.ok && h.value ? Number(h.value.prepareTicks) || 0 : 0;
};

/** Fire one prepare tick and WAIT FOR THE WATCHED COUNT TO MOVE — never a bare sleep. */
async function tickOnce(jobId, n) {
  const was = await watchedOf(jobId);
  const ran = await invoke("runScheduledJobNow", { id: jobId });
  if (!(ran.body && ran.body.success)) { FAIL(`tick ${n}: runScheduledJobNow refused: ${JSON.stringify(ran.body).slice(0, 200)}`); return null; }
  const deadline = Date.now() + TICK_WAIT_S * 1000;
  while (Date.now() < deadline) {
    await sleep(6000);
    if ((await watchedOf(jobId)) > was) break;
  }
  const watched = await watchedOf(jobId);
  if (watched <= was) FAIL(`tick ${n}: va_health.prepareTicks did not move off ${was} within ${TICK_WAIT_S}s`);
  const st = (await invoke("getVaStatus", { jobId })).body;
  return { st, watched, receipts: receiptsOf(st).filter((r) => r.phase === "prepare").length };
}

/* ── the Agents tab, for the one question only a browser answers ─────────────── */

async function readShadowBadge(personaName) {
  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 1200 } });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(`${BASE}/jira/apps/${APP}${STAGING_ENV ? "/" + STAGING_ENV : ""}`, { waitUntil: "domcontentloaded" });
    let frame = null;
    for (let i = 0; i < 90; i++) {
      frame = page.frames().find((f) => f.url().includes("cdn.prod.atlassian-dev.net"));
      if (frame && (await frame.locator(".tab-btn").count()) > 0) break;
      await sleep(1000);
    }
    if (!frame) return { error: "the admin panel iframe never appeared — is the persistent profile still signed in?" };
    await frame.locator(".tab-btn", { hasText: /^\s*Agents\s*$/ }).click();
    /* THE CARD IS TITLED BY THE PERSONA, NOT BY THE JOB NAME. Filtering on the job name
       matched nothing and reported a false NOT VERIFIED; `.va-agent-name` renders
       `va.persona.name`. The agent id is not in the DOM at all, so the persona name is
       the only handle — and the caller passes it. */
    const card = frame.locator(".va-agent").filter({ has: frame.locator(".va-agent-name", { hasText: personaName }) }).first();
    await card.waitFor({ state: "visible", timeout: 60000 });
    /*
     * WAIT FOR THE PER-AGENT STATUS FETCH BEFORE READING THE BADGE. The card renders from
     * `status` and `status` starts NULL — and a null status makes `shadow` null, which the
     * head paints as the LIVE badge and the Mode stat as "live". Reading the badge before
     * the fetch lands therefore reports a confident LIVE for an agent that is in shadow;
     * this script did exactly that once and filed it as a failure. "Last tick" is the tell:
     * it reads "not known yet" until the same fetch resolves.
     */
    for (let i = 0; i < 40; i++) {
      const lt = await card.locator(".va-stat").filter({ has: frame.locator(".va-stat-label", { hasText: /^Last tick$/ }) })
        .locator(".va-stat-value").first().innerText().catch(() => "");
      if (lt && !/not known yet/i.test(lt)) break;
      await sleep(1000);
    }
    await sleep(2000);
    const lastTick = await card.locator(".va-stat").filter({ has: frame.locator(".va-stat-label", { hasText: /^Last tick$/ }) })
      .locator(".va-stat-value").first().innerText().catch(() => null);
    const badge = card.locator(".va-badge").first();
    const badgeText = (await badge.innerText()).trim();
    const badgeClass = await badge.getAttribute("class");
    let mode = null;
    try {
      mode = (await card.locator(".va-stat").filter({ has: frame.locator(".va-stat-label", { hasText: /^Mode$/ }) })
        .locator(".va-stat-value").first().innerText()).trim();
    } catch { /* reported as null below */ }
    return { badgeText, badgeClass, mode, lastTick };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 200) };
  } finally { await ctx.close(); }
}

/* ── the journey ────────────────────────────────────────────────────────────── */

async function main() {
  console.log(`\nTHE SHADOW DOOR — live on ${ENV_NAME.toUpperCase()} (F-508 / F-514 / the shadow window itself)\n`);
  if (!HOOK_URL) throw new Error(`no web-trigger URL configured for environment "${ENV_NAME}"`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable / the secret was rejected (GET -> ${ping.status}). A rotated HARNESS_SECRET needs a redeploy of ${ENV_NAME}.`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);
  const urlRes = await hook(null, "GET", "?what=rulesApiUrl");
  RULES_URL = urlRes.body && urlRes.body.url;
  if (!RULES_URL) throw new Error(`could not discover the rules-api URL: ${urlRes.status}`);
  PASS("rules-api web-trigger URL discovered (not printed)");

  /* ── STEP 0 — the model the agent capability needs ───────────────────────── */
  if (FLIP_MODEL) {
    console.log("\nSTEP 0 — point the agent model at a frontier model for this run");
    const slot = await kvs(AGENT_MODEL_SLOT);
    agentModelSlotBefore = slot.value;
    info(`${AGENT_MODEL_SLOT} before: ${slot.value === null ? "EMPTY (the resolver answers a fallback)" : JSON.stringify(slot.value)} — the SLOT is what the finally replays`);
    const set = await invoke("saveAgentModel", { model: FRONTIER });
    if (set.body && set.body.success) PASS(`agent model flipped to "${FRONTIER}"`);
    else FAIL(`saveAgentModel("${FRONTIER}") refused: ${JSON.stringify(set.body).slice(0, 300)}`);
  }
  const cap = (await invoke("getAgentCapability", {})).body || {};
  info(`getAgentCapability -> enabled=${cap.enabled} reason="${cap.reason}" edition=${cap.edition} provider=${cap.provider} agentModel=${cap.agentModel}`);
  if (cap.enabled !== true) { FAIL(`the instance cannot hold an agent (${cap.reason}) — nothing below can run`); return; }

  /* ── STEP 1 — an agent with THREE shadow ticks ───────────────────────────── */
  console.log(`\nSTEP 1 — create an agent with shadowTicks=${SHADOW_TICKS}`);
  const name = `Shadow door proof ${Date.now().toString(36)}`;
  const created = await invoke("saveScheduledJob", { job: { name, mode: "va", enabled: true, va: vaRecord() } });
  if (!(created.body && created.body.success)) { FAIL(`saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 400)}`); return; }
  const job = created.body.job;
  const jobId = job.id;
  createdJobId = jobId;
  PASS(`agent created: ${jobId} shadowTicks=${job.va.guardrails.shadowTicks} shadowUntilTick=${job.va.status.shadowUntilTick}`);
  info(`refused[] on create (${(created.body.refused || []).length}): ${JSON.stringify(created.body.refused || [])}`);
  if (job.va.status.shadowUntilTick === SHADOW_TICKS) PASS(`a brand-new agent is armed to exactly shadowTicks (${SHADOW_TICKS}) — creation and the first edit agree`);
  else FAIL(`shadowUntilTick on create is ${job.va.status.shadowUntilTick}, not ${SHADOW_TICKS}`);

  const st0 = await invoke("getVaStatus", { jobId });
  info(`shadow at 0 watched ticks: ${JSON.stringify(st0.body && st0.body.shadow)}`);
  if (st0.body && st0.body.shadow) PASS("the agent starts IN shadow — it stages and posts nothing");
  else FAIL(`getVaStatus reports shadow=${JSON.stringify(st0.body && st0.body.shadow)} on a brand-new agent`);

  /* ── STEP 2 — four prepare ticks, watched one at a time ──────────────────── */
  console.log(`\nSTEP 2 — run FOUR prepare ticks (runScheduledJobNow → enqueueJobRun → isVaJob → va-tick; runVaTickNow is not allow-listed)`);
  const seen = [];
  for (let n = 1; n <= 4; n++) {
    const r = await tickOnce(jobId, n);
    const watched = (r && r.watched) || 0;
    const shadow = r && r.st && r.st.shadow;
    seen.push({ tick: n, watched, shadow: shadow ? { ticksLeft: shadow.ticksLeft, until: shadow.until, tickIndex: shadow.tickIndex } : null });
    info(`after tick ${n}: va_health.prepareTicks=${watched} (receipt rows=${r && r.receipts}) shadow=${JSON.stringify(shadow)}`);
  }
  const endedAt = seen.find((s) => s.shadow === null);
  if (endedAt) {
    if (endedAt.watched >= SHADOW_TICKS) PASS(`shadow ENDED once the agent had watched ${endedAt.watched} of its own ticks (shadowTicks=${SHADOW_TICKS}) — the unit is the agent's own va_health.prepareTicks, the counter the post gate reads, not wall clock (F-484)`);
    else FAIL(`shadow ended after only ${endedAt.watched} watched tick(s), fewer than shadowTicks=${SHADOW_TICKS}`);
  } else {
    FAIL(`shadow never ended across four ticks: ${JSON.stringify(seen)}`);
  }
  const stillShadowedEarly = seen.filter((s) => s.watched < SHADOW_TICKS && s.shadow === null);
  if (!stillShadowedEarly.length) PASS("the agent was never OUT of shadow before it had watched its three ticks — the window did not open early");
  else FAIL(`the agent left shadow early: ${JSON.stringify(stillShadowedEarly)}`);

  /* ── STEP 3 — F-508: a long watch is STORED and NAMED, never silently cut ── */
  console.log("\nSTEP 3 — F-508: PUT {va:{status:{shadowUntilTick:500}}} through the REST door");
  const tok = await invoke("createApiToken", { name: `shadow-door ${Date.now()}`, role: "admin" });
  if (!(tok.body && tok.body.success && tok.body.token)) { FAIL(`createApiToken refused: ${JSON.stringify(tok.body).slice(0, 300)}`); return; }
  cleanupTokens.push(tok.body.row.id);
  const TOKEN = tok.body.token;
  PASS("an ADMIN api token was minted for the REST door (never printed)");

  const stBefore = (await invoke("getScheduledJob", { id: jobId })).body?.job?.va?.status;
  info(`status before the PUT: ${JSON.stringify(stBefore)}`);
  const put500 = await rest(TOKEN, "PUT", { resource: "agents", id: jobId }, { va: { status: { shadowUntilTick: 500 } } });
  info(`PUT 500 -> ${put500.status}`);
  const say500 = [...((put500.body && put500.body.refused) || []), ...((put500.body && put500.body.notes) || [])];
  info(`refused[]/notes[] (${say500.length}): ${JSON.stringify(say500)}`);
  const st500 = (await invoke("getScheduledJob", { id: jobId })).body?.job?.va?.status;
  info(`status after the PUT (second read, through a different call): ${JSON.stringify(st500)}`);
  if (st500 && st500.shadowUntilTick === 500) PASS("500 was STORED VERBATIM — the ceiling did not shorten a watch the admin armed (F-508)");
  else FAIL(`shadowUntilTick was stored as ${st500 && st500.shadowUntilTick}, not 500 — a value nobody was told about`);
  const reach = say500.find((r) => /shadow/i.test(String(r.field || "")) || /shadow mode|watched|ticks/i.test(String(r.reason || "")));
  if (reach) PASS(`the answer NAMES the reachability of the watch: ${JSON.stringify(reach)}`);
  else FAIL(`the save answered with NO row about the long watch — silence is the F-508 defect: ${JSON.stringify(say500)}`);
  if (st500 && stBefore && st500.paused === stBefore.paused) PASS(`paused survived the shadowUntilTick PUT (${st500.paused}) — a partial va PUT is a PATCH (F-477)`);
  else FAIL(`the PUT also changed paused: ${stBefore && stBefore.paused} -> ${st500 && st500.paused}`);

  /* ── STEP 4 — the badge the admin actually sees ──────────────────────────── */
  if (NO_UI) {
    NV("--no-ui: the Agents tab badge for the 500 case was not read in a browser");
  } else {
    console.log("\nSTEP 4 — the SHADOW badge in the Agents tab, for the 500 case");
    const ui = await readShadowBadge("Nadia");
    if (ui.error) {
      NV(`the Agents tab could not be read (${ui.error}), so the badge for the 500 case is UNPROVEN`);
    } else {
      info(`badge: "${ui.badgeText}" (class="${ui.badgeClass}")  mode line: ${JSON.stringify(ui.mode)}  last tick: ${JSON.stringify(ui.lastTick)}`);
      if (/SHADOW/i.test(ui.badgeText)) PASS("the Agents tab shows the SHADOW badge while the long watch is armed");
      else FAIL(`the Agents tab badge reads "${ui.badgeText}" — the admin is not told the agent is in shadow`);
      const left = String(ui.mode || "").match(/(\d+)\s*ticks?\s*left/i);
      if (left && Number(left[1]) > 400) PASS(`the tab names how long the watch is: "${ui.mode}" — the admin sees the 500, not a 6`);
      else FAIL(`the tab's mode line does not name a long watch: ${JSON.stringify(ui.mode)}`);
    }
  }

  /* ── STEP 5 — a value that is not a watch at all ─────────────────────────── */
  console.log("\nSTEP 5 — PUT {shadowUntilTick:50000}: above the ceiling, so CLAMPED and reported");
  const put50k = await rest(TOKEN, "PUT", { resource: "agents", id: jobId }, { va: { status: { shadowUntilTick: 50000 } } });
  info(`PUT 50000 -> ${put50k.status}`);
  const say50k = [...((put50k.body && put50k.body.refused) || []), ...((put50k.body && put50k.body.notes) || [])];
  info(`refused[]/notes[] (${say50k.length}): ${JSON.stringify(say50k)}`);
  const st50k = (await invoke("getScheduledJob", { id: jobId })).body?.job?.va?.status;
  info(`status after (second read): ${JSON.stringify(st50k)}`);
  const stored = st50k && st50k.shadowUntilTick;
  if (stored != null && stored < 50000) PASS(`50000 was CLAMPED to ${stored} — the absolute ceiling, not a runaway watched+k`);
  else FAIL(`50000 was stored as ${stored} — the ceiling did not bind`);
  const said50k = say50k.find((r) => /shadow/i.test(String(r.field || "")) || /shadow|tick/i.test(String(r.reason || "")));
  if (said50k) PASS(`the clamp is REPORTED, not silent: ${JSON.stringify(said50k)}`);
  else FAIL(`50000 was clamped SILENTLY — refused[]/notes[] say nothing about it: ${JSON.stringify(say50k)}`);

  /* ── STEP 6 — the purge, proven by second reads ──────────────────────────── */
  if (KEEP) { console.log("\nSTEP 6 — SKIPPED (--keep)."); return; }
  console.log("\nSTEP 6 — delete the agent and prove every row it could have left is GONE");
  const idx = (await kvs(`va_index:${jobId}`)).value;
  const items = (idx && Array.isArray(idx.ids) ? idx.ids : []).map((k) => `va_item:${jobId}:${k}`);
  const KEYS = [`va_index:${jobId}`, `va_health:${jobId}`, `va_memory:${jobId}`, `va_compact_backoff:${jobId}`, ...items];
  const beforeRows = {};
  for (const k of KEYS) beforeRows[k] = (await kvs(k)).value;
  info(`rows BEFORE the delete: ${JSON.stringify(Object.fromEntries(Object.entries(beforeRows).map(([k, v]) => [k, v === null ? "absent" : "present"])))}`);
  const sawSomething = Object.entries(beforeRows).filter(([, v]) => v !== null).map(([k]) => k);
  if (sawSomething.length) PASS(`the KVS read CAN see this agent's rows while it lives (${sawSomething.join(", ")}) — the control every "gone" below rests on`);
  else FAIL("the KVS read saw NO row for this agent before the delete, so an absence afterwards would prove nothing");

  const del = await invoke("deleteScheduledJob", { id: jobId });
  if (del.body && del.body.success) PASS(`deleteScheduledJob: ${JSON.stringify(del.body).slice(0, 200)}`);
  else FAIL(`deleteScheduledJob refused: ${JSON.stringify(del.body).slice(0, 300)}`);
  const back = await invoke("getScheduledJob", { id: jobId });
  if (!(back.body && back.body.job)) PASS("the second read (getScheduledJob, a different call than the delete) no longer finds the agent");
  else FAIL(`getScheduledJob still returns the agent ${jobId}`);
  createdJobId = null;

  const residue = [];
  for (const k of KEYS) {
    const r = await kvs(k);
    if (!r.ok) { NV(`${k} could not be read (HTTP ${r.status}), so its purge is UNPROVEN`); continue; }
    if (r.value === null) info(`${k}: gone`);
    else residue.push(k);
  }
  if (!residue.length) PASS(`every va_* row this agent could have left is ABSENT on a second read: ${KEYS.join(", ")}`);
  else FAIL(`rows SURVIVED the delete: ${residue.join(", ")}`);
  /*
   * AND AGAIN, THIRTY SECONDS LATER. A purge is only clean if it STAYS clean: an item
   * turn still in the queue when the agent was deleted writes its row when it finishes,
   * and a single read taken the instant after the delete cannot see that. This second
   * sweep is what turned a "gone" into a resurrection on the run that found it.
   */
  await sleep(30000);
  const late = [];
  for (const k of KEYS) {
    const r = await kvs(k);
    if (r.ok && r.value !== null) late.push(k);
  }
  if (!late.length) PASS("and still absent 30s after the delete — nothing in flight wrote a row back");
  else FAIL(`rows were RE-CREATED after the purge (an in-flight turn wrote back for a deleted agent): ${late.join(", ")}`);

  const bo = await kvs(`va_compact_backoff:${jobId}`);
  if (bo.ok && bo.value === null) PASS("va_compact_backoff is absent — it is swept with the agent (F-512), not left to its own 6 h TTL");
  else if (!bo.ok) NV(`va_compact_backoff could not be read (HTTP ${bo.status})`);
  else FAIL(`va_compact_backoff SURVIVED the delete: ${JSON.stringify(bo.value)}`);
}

main()
  .catch((e) => { console.error("\nDRIVER ERROR:", e && e.stack); process.exitCode = 1; })
  .finally(async () => {
    /* THE RESTORE IS AN ASSERTION. An agent left enabled on a live site, or a model slot
       left pointing somewhere this run put it, is damage — so both are re-read. */
    const left = [];
    if (createdJobId && !KEEP) {
      console.log(`\nCLEANUP — the run did not reach the delete; removing ${createdJobId}`);
      await invoke("deleteScheduledJob", { id: createdJobId }).catch(() => null);
      const back = await invoke("getScheduledJob", { id: createdJobId }).catch(() => null);
      const survives = !!(back && back.body && back.body.job);
      console.log(`        second read getScheduledJob ${createdJobId}: ${survives ? "STILL PRESENT" : "gone"}`);
      if (survives) left.push(`the Virtual Administrator ${createdJobId} is still on the instance`);
    }
    for (const id of cleanupTokens) {
      await invoke("deleteApiToken", { id }).catch(() => null);
    }
    if (agentModelSlotBefore !== undefined) {
      await hook({ action: "kvSet", key: AGENT_MODEL_SLOT, value: agentModelSlotBefore });
      const back = await kvs(AGENT_MODEL_SLOT);
      const ok = !!(back.ok && JSON.stringify(back.value) === JSON.stringify(agentModelSlotBefore));
      console.log(`        ${ok ? "RESTORED" : "NOT RESTORED"}: ${AGENT_MODEL_SLOT} reads back ${JSON.stringify(back.value)} (was ${JSON.stringify(agentModelSlotBefore)})`);
      if (!ok) left.push(`${AGENT_MODEL_SLOT} still holds ${JSON.stringify(back.value)}`);
    }
    console.log(`\nRESULT — ${passes} pass, ${fails} fail, ${unproven} not verified`);
    if (left.length) { console.error(`\nCLEANUP FAILED — ${left.join("; ")}`); process.exitCode = 1; }
    if (fails) process.exitCode = 1;
  });
