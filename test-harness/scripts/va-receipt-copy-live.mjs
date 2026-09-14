/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-577 / F-501 — WHAT THE ADMINISTRATOR ACTUALLY READS ON A REFUSED TICK.
 *
 * A receipt field in a JSON body is not copy. This drives three receipts onto ONE agent and
 * then reads them off the real Agents tab in a real browser, through the admin profile:
 *
 *   · `capability`  — the agent model is put back to Haiku, so the tick is refused before the
 *                     sweep. The row must render as the F-501 COPY ROW (`.va-receipt-cap`)
 *                     carrying agentCapabilityCopy("needs-frontier-model")'s own title and
 *                     remedy — the same words the Settings tab and the Coder panel use.
 *   · `purge-settling` — the agent is deleted and re-created with the SAME id and ticked
 *                     inside the 5-minute settle window, so the F-575 skip lands. It must
 *                     render the mapped sentence, never a bare id as the whole explanation.
 *   · `agent-purged` — recorded if the engine produces one (it arrives on a skip with NO
 *                     `gate`, which is the exact F-577 case that used to print the raw id).
 *
 * THE NEGATIVE IS PROVEN, NOT OBSERVED. The pane is only read once the card's Ticks tab has
 * rendered at least one receipt, and every assertion below names the row it read. A missing
 * row is reported NOT VERIFIED, never as a pass.
 *
 * NOT A DEFECT, AND WORTH SAYING ONCE: a `.va-receipt-skip` row renders a small GATE CHIP
 * carrying the id BESIDE the sentence (AgentsTab.jsx, the `!c.copy` branch). "Never a raw
 * id" means never an id INSTEAD of the sentence; the chip is deliberate.
 *
 * NOTHING IS POSTED: replyInternal only, shadowUntilTick 500, and the project's comment
 * total is read before and after.
 *
 * Usage (from test-harness/):  node scripts/va-receipt-copy-live.mjs [--keep]
 * Env: STAGING_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID + the JIRA_* trio.
 */
import { requireEnvAck, forgeEnvId } from "../lib/shared-env-guard.mjs";
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";

const { hookUrl: HOOK_URL } = requireEnvAck(process.argv.slice(2), { faults: [], defaultEnv: "staging" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "JT");
const DESK_ID = arg("desk", "1");
const QUEUES = arg("queues", "1,2,3").split(",").filter(Boolean);
const FRONTIER = arg("model", "claude-sonnet-5");
const KEEP = flag("keep");
/* F-577 SEQUENCING, LEARNED LIVE (2026-09-13): `clearPurgeTombstone` runs FIRST in the tick,
   BEFORE the capability arm, so a run that has just deleted-and-re-created the agent spends
   its next 5 minutes answering `purge-settling` and the capability arm is never reached. The
   two receipts therefore cannot be driven on one agent inside one settle window. `--no-purge`
   drives the capability row alone, on a fresh agent that was never deleted. */
const NO_PURGE = flag("no-purge");
const AGENT_MODEL_SLOT = "COGNIRUNNER_AGENT_MODEL_atlassian";
const ADMIN_PAGE = `https://wolfaenpak.atlassian.net/jira/apps/36415848-6868-4697-9554-3c3ad87b8da9/${forgeEnvId("staging")}`;
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const NAME = `Copyprobe${Date.now().toString(36).slice(-4)}`;
const OUT = new URL("../results/va-receipt-copy", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { name: NAME, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);
const restore = { agentId: null, agentModelSlot: undefined };

async function fetchRetry(url, init, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, init); } catch (e) { last = e; await sleep(2000 * (i + 1)); }
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
  return readRes(await fetchRetry(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
const invoke = async (functionKey, payload = {}) => {
  const r = await hook({ action: "invokeResolver", functionKey, payload, accountId: ADMIN });
  return { status: r.status, body: r.json };
};
const kvs = async (key) => {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`);
  return r.status === 200 && r.json ? (r.json.value === undefined ? null : r.json.value) : null;
};
const AUTH = "Basic " + Buffer.from(`${requireEnv("JIRA_ADMIN_EMAIL")}:${requireEnv("JIRA_API_TOKEN")}`).toString("base64");
const jira = async (path) => readRes(await fetchRetry(requireEnv("JIRA_BASE_URL") + path, { headers: { Authorization: AUTH, Accept: "application/json" } }));
async function commentTotal() {
  const s = await jira(`/rest/api/3/search/jql?jql=${encodeURIComponent(`project = ${PROJECT} ORDER BY created DESC`)}&maxResults=100&fields=summary`);
  const keys = ((s.json && s.json.issues) || []).map((i) => i.key);
  let total = 0;
  for (const k of keys) { const r = await jira(`/rest/api/3/issue/${k}/comment?maxResults=1`); if (r.status === 200 && r.json) total += Number(r.json.total); }
  return total;
}

const receiptsOf = (s) => (s && Array.isArray(s.receipts) ? s.receipts : []);
const vaRecord = () => ({
  persona: { name: NAME, voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: { serviceDesks: [{ serviceDeskId: DESK_ID, queueIds: QUEUES }], jql: `project = ${PROJECT}`, mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: 3, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 1, maxWritesPerRun: 5 },
  status: { paused: false, shadowUntilTick: 500 },
});

async function tick(jobId, label, waitS = 180) {
  const before = receiptsOf((await invoke("getVaStatus", { jobId })).body).length;
  const ran = await invoke("runScheduledJobNow", { id: jobId });
  if (!(ran.body && ran.body.success)) { FAIL(`${label}: runScheduledJobNow refused`, { body: JSON.stringify(ran.body).slice(0, 260) }); return null; }
  const deadline = Date.now() + waitS * 1000;
  while (Date.now() < deadline) {
    const st = (await invoke("getVaStatus", { jobId })).body;
    const rs = receiptsOf(st);
    if (rs.length > before) return rs[0];
    await sleep(7000);
  }
  NV(`${label}: no new receipt within ${waitS}s`);
  return null;
}

async function main() {
  console.log(`\nF-577 — THE RECEIPT COPY AN ADMINISTRATOR READS, on STAGING, agent ${NAME}\n`);
  if ((await hook(null, "GET")).status !== 200) throw new Error("the staging hook is not reachable");
  PASS("hook reachable on staging");

  const slot0 = await kvs(AGENT_MODEL_SLOT);
  restore.agentModelSlot = slot0;
  info(`${AGENT_MODEL_SLOT} recorded: ${slot0 === null ? "EMPTY" : JSON.stringify(slot0)}`);
  const set = await invoke("saveAgentModel", { model: FRONTIER });
  if (!(set.body && set.body.success)) throw new Error(`saveAgentModel refused: ${JSON.stringify(set.body).slice(0, 240)}`);
  await sleep(35000);
  const cap = await invoke("getAgentCapability");
  if (!(cap.body && cap.body.enabled === true)) { FAIL("capability did not come on", { cap: cap.body }); return; }
  PASS(`capability ON (${cap.body.agentModel})`);
  const cBefore = await commentTotal();

  /* ── the agent, one normal tick ─────────────────────────────────────────── */
  const created = await invoke("saveScheduledJob", { job: { name: `F-577 copy proof ${NAME}`, mode: "va", enabled: true, va: vaRecord() } });
  if (!(created.body && created.body.success)) throw new Error(`saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 300)}`);
  const jobId = created.body.job.id;
  restore.agentId = jobId;
  PASS(`agent ${jobId} created`);
  const r0 = await tick(jobId, "baseline tick");
  info(`baseline receipt: ${JSON.stringify(r0).slice(0, 300)}`);

  /* ── purge-settling: delete, re-create with the same id, tick in-window ─── */
  const del = NO_PURGE ? { body: { success: true, skipped: true } } : await invoke("deleteScheduledJob", { id: jobId });
  if (NO_PURGE) { NV("--no-purge: the delete/re-create arm was skipped so the capability arm is reachable"); }
  else if (!(del.body && del.body.success)) { FAIL("deleteScheduledJob refused", { body: JSON.stringify(del.body).slice(0, 240) }); return; }
  if (!NO_PURGE) restore.agentId = null;
  const tomb = NO_PURGE ? null : await kvs(`va_purged:${jobId}`);
  if (NO_PURGE) { /* nothing to assert */ }
  else if (tomb && tomb.at) PASS("the tombstone stands", { at: tomb.at }); else FAIL("no tombstone", { tomb });
  const re = NO_PURGE ? { body: { success: true, job: { id: jobId } } } : await invoke("saveScheduledJob", { job: { id: jobId, name: `F-577 copy proof ${NAME} (recreated)`, mode: "va", enabled: true, va: vaRecord() } });
  if (!(re.body && re.body.success && re.body.job && re.body.job.id === jobId)) {
    NV("saveScheduledJob would not re-create the deleted id — the purge-settling row cannot be driven", { body: JSON.stringify(re.body).slice(0, 240) });
  } else {
    restore.agentId = jobId;
    PASS(`re-created with the same id ${jobId}`);
    const rSettle = await tick(jobId, "in-window tick");
    ev.receiptSettling = rSettle;
    info(`in-window receipt: ${JSON.stringify(rSettle).slice(0, 400)}`);
    const g = ((rSettle && rSettle.skipped) || []).find((s) => s && s.gate === "purge-settling");
    if (g) PASS('a purge-settling receipt exists to render', { reason: g.reason }); else NV("no purge-settling skip was produced", { skipped: rSettle && rSettle.skipped });
  }

  /* ── capability: put the model back, tick again ─────────────────────────── */
  const back = await hook({ action: "kvSet", key: AGENT_MODEL_SLOT, value: slot0 });
  if (back.status === 200) { restore.agentModelSlot = undefined; PASS("the agent model slot is back to its recorded value — capability goes off"); }
  else FAIL("could not put the agent model slot back", { status: back.status });
  await sleep(35000);
  const cap2 = await invoke("getAgentCapability");
  info(`getAgentCapability now: ${JSON.stringify(cap2.body)}`);
  if (restore.agentId) {
    const rCap = await tick(jobId, "capability tick");
    ev.receiptCapability = rCap;
    info(`capability receipt: ${JSON.stringify(rCap).slice(0, 400)}`);
    const g = ((rCap && rCap.skipped) || []).find((s) => s && s.gate === "capability");
    if (g) PASS("a capability receipt exists to render", { reason: g.reason }); else NV("no capability skip was produced", { skipped: rCap && rCap.skipped });
  }

  /* ── THE ADMINISTRATOR'S OWN EYES ───────────────────────────────────────── */
  console.log("\nTHE AGENTS TAB, in a real browser");
  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 1400 } });
  try {
    const p = ctx.pages()[0] || await ctx.newPage();
    await p.goto(ADMIN_PAGE, { waitUntil: "domcontentloaded" });
    let f = null;
    for (let i = 0; i < 90; i++) { f = p.frames().find((x) => x.url().includes("cdn.prod.atlassian-dev.net")); if (f && await f.locator(".tab-btn").count() > 0) break; await sleep(1000); }
    if (!f) throw new Error("the admin panel iframe never rendered");
    await f.locator(".tab-btn", { hasText: /^\s*Agents\s*$/ }).click();
    const card = f.locator(".va-agent").filter({ has: f.locator(".va-agent-name", { hasText: NAME }) }).first();
    await card.waitFor({ state: "visible", timeout: 90000 });
    PASS(`the agent card for ${NAME} is on the Agents tab`);
    await card.locator(".rule-expand-btn").first().click();
    await card.locator(".va-pane-btn", { hasText: /^Ticks$/ }).click();
    let rows = 0;
    for (let i = 0; i < 40; i++) { rows = await card.locator(".va-receipt").count(); if (rows > 0) break; await sleep(1000); }
    if (!rows) { NV("the Ticks pane rendered no receipt — nothing to read"); }
    else {
      PASS(`the Ticks pane renders ${rows} receipt(s)`);
      const paneText = await card.locator(".va-receipts").innerText();
      ev.paneText = paneText;
      await card.screenshot({ path: OUT + "/agents-tab-receipts.png" });
      info(`pane text:\n${paneText.split("\n").map((l) => "          " + l).join("\n")}`);

      // capability — the F-501 COPY ROW, with the ONE home's words
      const capTitle = "Coder is off - the agent model is not a frontier model";
      const capRemedy = "Haiku never drives an agent.";
      const capRows = await card.locator(".va-receipt-cap").count();
      if (paneText.includes(capTitle) && paneText.includes(capRemedy)) PASS("the capability skip renders agentCapabilityCopy's own title AND remedy", { capRows });
      else if (ev.receiptCapability) FAIL("a capability skip exists but its mapped sentence is not on screen", { capRows, want: capTitle });
      else NV("no capability skip was produced, so its copy row cannot be judged");

      // purge-settling — the mapped sentence, not a bare id
      const settleSentence = "It is waiting for the deleted agent's last turns to finish before it starts.";
      if (ev.receiptSettling && ((ev.receiptSettling.skipped || []).some((s) => s && s.gate === "purge-settling"))) {
        if (paneText.includes(settleSentence)) PASS("the purge-settling skip renders its mapped sentence");
        else FAIL("a purge-settling skip exists but its mapped sentence is not on screen", { want: settleSentence });
      } else NV("no purge-settling skip was produced, so its row cannot be judged");

      // agent-purged — only if the engine made one
      const purgedSentence = "This agent was deleted before the turn started, so nothing was written.";
      const purgedAfter = "This agent was deleted while a turn was running";
      const sawPurgedId = /(^|\n)\s*agent-purged\s*$/m.test(paneText);
      if (paneText.includes(purgedSentence) || paneText.includes(purgedAfter)) PASS("an agent-purged row rendered its mapped sentence");
      else NV("no agent-purged row appeared on this run, so F-577's own row is not judged here");

      // THE NEGATIVE: no row explains itself with a bare id.
      const bare = ["purge-settling", "agent-purged", "capability", "agent-purged-after-writes"]
        .filter((id) => new RegExp(`(^|\\n)\\s*${id}\\s*(\\n|$)`).test(paneText));
      // A GATE CHIP carries the id beside the sentence by design; a whole LINE that is only
      // the id is the F-577 defect. The chip and the sentence are siblings in one row, so
      // innerText puts them on the same line — a line that is nothing but the id is the tell.
      if (!bare.length) PASS("no receipt row explains itself with a bare id on its own line");
      else FAIL("a receipt row printed a bare id as its whole explanation", { ids: bare, sawPurgedId });
    }
  } finally { await ctx.close(); }

  const cAfter = await commentTotal();
  ev.comments = { before: cBefore, after: cAfter };
  if (cAfter === cBefore) PASS("no comment was posted in the project", { total: cAfter });
  else FAIL("the project's comment total moved", { before: cBefore, after: cAfter });
}

try { await main(); } catch (e) { console.error("THREW", e.stack); fails += 1; }
finally {
  try {
    if (restore.agentId && !KEEP) {
      const r = await invoke("deleteScheduledJob", { id: restore.agentId });
      info(`cleanup deleteScheduledJob ${restore.agentId}: ${JSON.stringify(r.body).slice(0, 160)}`);
    }
    if (restore.agentModelSlot !== undefined) {
      const r = await hook({ action: "kvSet", key: AGENT_MODEL_SLOT, value: restore.agentModelSlot });
      if (r.status === 200) PASS(`${AGENT_MODEL_SLOT} restored`); else FAIL(`${AGENT_MODEL_SLOT} restore did not confirm`, { status: r.status });
    }
  } catch (e) { console.error("CLEANUP FAILED", e.message); fails += 1; }
  fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
  console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/`);
  process.exit(fails ? 1 : 0);
}
