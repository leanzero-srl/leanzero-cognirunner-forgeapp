/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-614 / F-608 / F-616 — THE THREE DOORS THAT ARE NOT THE TICK.
 *
 * `va-recreate-settle-live.mjs` proves the ENGINE half of the settle window (plant, tick
 * skipped, age, receipt, tombstone gone). It does NOT prove the half F-614 is actually
 * about: that the wait reaches a SCREEN. The Agents tab renders `settlingLine()` off
 * `status.settling`, a projection `getVaStatus` computes from the tombstone — so the live
 * question is whether that field is populated while a tombstone stands, and empty when
 * none does. Both are asked HERE, on the SAME agent, in that order: a negative first so
 * the positive cannot be a query that sees nothing.
 *
 * THE REST TWINS. `POST ?resource=agents` carrying an id that names no row must be a 404
 * and must write NOTHING (F-616's door on the REST side, read back through `?what=kvs` on
 * the exact key the create would have taken). `GET ?resource=agents&part=purges` must
 * answer the admin with the same body the resolver gives, and must refuse a non-admin with
 * a SENTENCE rather than a fault (F-608).
 *
 * NOTHING IS POSTED and NOTHING IS TICKED: no `runScheduledJobNow` call is made at all, the
 * agent is created PAUSED with `replyInternal` as its only power, and the project's comment
 * total is read before and after anyway. The agent-model KVS slot is recorded and replayed
 * in a `finally`; the tombstone is cleared and the agent deleted, both proven by a re-read.
 *
 * Usage (from test-harness/):  node scripts/va-settling-carrier-live.mjs [--env=staging|dev] [--keep]
 * Env: STAGING_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID + the JIRA_* trio.
 * Nothing secret is printed: not the secret, not the trigger URL, not the REST token.
 */
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";

const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["agents", "jobs", "providerSlot", "kvs"], defaultEnv: "staging" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const NON_ADMIN = "712020:00000000-0000-0000-0000-000000000000"; // an account that is nobody here
const PROJECT = arg("project", "JT");
const DESK_ID = arg("desk", "1");
const QUEUES = arg("queues", "1,2,3").split(",").filter(Boolean);
const FRONTIER = arg("model", "claude-sonnet-5");
const SETTLE_MS = 5 * 60 * 1000; // VA_PURGE_SETTLE_MS, src/shared/va-keys.js
const KEEP = flag("keep");
const AGENT_MODEL_SLOT = "COGNIRUNNER_AGENT_MODEL_atlassian";
const OUT = new URL("../results/va-settling-carrier", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: ENV_NAME, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);

const readRes = async (res) => {
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, json: null, raw: e.message }; }
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, raw: json ? null : text.slice(0, 300) };
};
async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  return readRes(await fetch(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
const invoke = async (functionKey, payload = {}, accountId = ADMIN) =>
  hook({ action: "invokeResolver", functionKey, payload, accountId });
const kvs = async (key) => {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`);
  return { status: r.status, value: r.json ? (r.json.value ?? null) : null };
};
const tombstone = (op, agent, extra = {}) => hook({ action: "vaTombstone", op, agent, ...extra });

const AUTH = "Basic " + Buffer.from(`${requireEnv("JIRA_ADMIN_EMAIL")}:${requireEnv("JIRA_API_TOKEN")}`).toString("base64");
const jira = async (path, init = {}) => readRes(await fetch(requireEnv("JIRA_BASE_URL") + path, {
  ...init, headers: { Authorization: AUTH, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) },
}));
async function commentTotal() {
  const s = await jira(`/rest/api/3/search/jql?jql=${encodeURIComponent(`project = ${PROJECT} ORDER BY created DESC`)}&maxResults=100&fields=summary`);
  const keys = ((s.json && s.json.issues) || []).map((i) => i.key);
  let total = 0;
  for (const k of keys) { const r = await jira(`/rest/api/3/issue/${k}/comment?maxResults=1`); if (r.status === 200 && r.json) total += Number(r.json.total); }
  return { issues: keys.length, comments: total };
}

const vaRecord = () => ({
  persona: { name: "Carrier", voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: { serviceDesks: [{ serviceDeskId: DESK_ID, queueIds: QUEUES }], jql: `project = ${PROJECT}`, mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: 3, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 2, maxWritesPerRun: 10 },
  status: { paused: true, shadowUntilTick: 500 },
});

/* ── the REST door: URL + a minted token, both discovered through the hook ── */
async function restApi() {
  const u = await hook(null, "GET", "?what=rulesApiUrl");
  const url = u.json && u.json.url;
  if (!url) return null;
  const t = await hook({ action: "mintApiToken", name: `settling-carrier-${Date.now().toString(36)}` });
  const token = t.json && (t.json.token);
  if (!token) return null;
  return {
    id: (t.json.row && t.json.row.id) || null,
    call: async (method, query, body) => readRes(await fetch(`${url}?${query}`, {
      method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })),
  };
}

async function main() {
  console.log(`\nF-614 / F-608 / F-616 — the settling CARRIER and the REST doors, on ${ENV_NAME.toUpperCase()}, project ${PROJECT}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  const restore = {};
  let agentId = null;
  let rest = null;
  try {
    const cap0 = await invoke("getAgentCapability");
    if (cap0.json && cap0.json.enabled !== true) {
      if (cap0.json.reason !== "needs-frontier-model") { NV(`capability is off for "${cap0.json.reason}" and this script may not change that`); return; }
      const slot = await kvs(AGENT_MODEL_SLOT);
      restore.agentModelSlot = slot.value;
      info(`${AGENT_MODEL_SLOT} recorded before the flip: ${slot.value === null ? "EMPTY" : "(a model id, recorded)"}`);
      const set = await invoke("saveAgentModel", { model: FRONTIER });
      if (!(set.json && set.json.success)) throw new Error("saveAgentModel refused");
      info("waiting 35s for the ~30s provider/model config cache");
      await sleep(35000);
    }
    const cap1 = await invoke("getAgentCapability");
    if (!(cap1.json && cap1.json.enabled === true)) { FAIL("capability is still off", { cap: cap1.json }); return; }
    PASS(`capability is ON (edition=${cap1.json.edition} agentModel=${cap1.json.agentModel})`);

    const cBefore = await commentTotal();
    info(`${PROJECT} before: ${JSON.stringify(cBefore)}`);

    /* ── STEP 1 — an agent, PAUSED, never ticked ──────────────────────────── */
    console.log("\nSTEP 1 - a paused agent (no tick is ever fired by this script)");
    const created = await invoke("saveScheduledJob", { job: { name: `F-614 carrier proof ${Date.now()}`, mode: "va", enabled: true, va: vaRecord() } });
    if (!(created.json && created.json.success)) throw new Error(`saveScheduledJob refused: ${JSON.stringify(created.json).slice(0, 300)}`);
    agentId = created.json.job.id;
    PASS(`agent ${agentId} created (createdAt=${created.json.job.createdAt})`);

    /* ── STEP 2 — the NEGATIVE, on this same agent ────────────────────────── */
    console.log("\nSTEP 2 - with no tombstone, `status.settling` must be absent (the control)");
    const before = await invoke("getVaStatus", { jobId: agentId });
    const sBefore = before.json || {};
    ev.statusBefore = { settling: sBefore.settling ?? null, receipts: Array.isArray(sBefore.receipts) ? sBefore.receipts.length : null };
    if (sBefore && Object.prototype.hasOwnProperty.call(sBefore, "receipts")) {
      PASS("getVaStatus CAN see this agent (it answered a status body for it) - the control is a real read", ev.statusBefore);
    } else {
      FAIL("getVaStatus did not answer a status body for this agent; the absence below would prove nothing", { body: JSON.stringify(before.json).slice(0, 300) });
    }
    if (!sBefore.settling) PASS("no tombstone stands, and `settling` is absent");
    else FAIL("`settling` is populated with no tombstone planted", { settling: sBefore.settling });

    /* ── STEP 3 — plant, then the POSITIVE on the same read ───────────────── */
    console.log("\nSTEP 3 - plant a tombstone, and read the carrier the Agents tab renders");
    const planted = await tombstone("plant", agentId);
    if (!(planted.json && planted.json.ok)) { FAIL("the tombstone could not be planted", { status: planted.status, body: JSON.stringify(planted.json).slice(0, 300) }); return; }
    PASS(`va_purged:${agentId} planted`, { at: planted.json.row.at, clamped: planted.json.clampedToCreatedAt });
    const after = await invoke("getVaStatus", { jobId: agentId });
    const settling = after.json && after.json.settling;
    ev.settling = settling || null;
    if (settling && typeof settling === "object") {
      PASS("`status.settling` is populated while the tombstone stands - the copy has a live carrier", settling);
      const since = Date.parse(settling.since || "");
      const until = Date.parse(settling.until || "");
      if (Number.isFinite(since) && Number.isFinite(until) && Math.abs(until - since - SETTLE_MS) < 2000) {
        PASS("`until` is `since` + VA_PURGE_SETTLE_MS, so the HH:MM the card prints is the engine's own window", { since: settling.since, until: settling.until });
      } else {
        FAIL("`until` is not one settle window after `since`", { since: settling.since, until: settling.until });
      }
      if (settling.reason === "purge-settling" || settling.reason === "window") {
        PASS("the reason names the purge-settling state the STATUS_COPY row is keyed on", { reason: settling.reason });
      } else {
        NV("the reason is not one this script knows how to grade", { reason: settling.reason });
      }
    } else {
      FAIL("`status.settling` is EMPTY while a tombstone stands - F-614's carrier is not populated", { status: JSON.stringify(after.json || null).slice(0, 300) });
    }

    /* ── STEP 4 — the REST doors ──────────────────────────────────────────── */
    console.log("\nSTEP 4 - the REST twins");
    rest = await restApi();
    if (!rest) { NV("the Rules REST API url/token could not be discovered through the hook - the REST arms are not evaluated"); }
    else {
      // positive control: the door can SEE agents at all.
      const list = await rest.call("GET", "resource=agents");
      const sawAgent = list.status === 200 && JSON.stringify(list.json || {}).includes(agentId);
      if (sawAgent) PASS("the REST agents door can see THIS agent - every 404/empty below is a measured absence", { status: list.status });
      else FAIL("the REST agents door cannot see this agent; nothing below would be evidence", { status: list.status, body: JSON.stringify(list.json).slice(0, 200) });

      const ghostId = `job_ghost_${Date.now().toString(36)}`;
      const ghostKey = `job:${ghostId}`;
      const kBefore = await kvs(ghostKey);
      const post = await rest.call("POST", "resource=agents", { id: ghostId, name: "F-616 REST ghost", mode: "va", enabled: true, va: vaRecord() });
      ev.restGhost = { status: post.status, body: JSON.stringify(post.json).slice(0, 300) };
      if (post.status === 404) PASS("POST ?resource=agents with an unknown id is a 404", { error: post.json && post.json.error });
      else FAIL("POST ?resource=agents with an unknown id was NOT a 404", ev.restGhost);
      const kAfter = await kvs(ghostKey);
      if (kBefore.value === null && kAfter.value === null) PASS("and NO row was written at that id (read before and after on the same key)", { key: ghostKey });
      else FAIL("a row exists at the ghost id after the refused POST", { before: kBefore.value, after: kAfter.value });

      const purgesAdmin = await rest.call("GET", "resource=agents&part=purges");
      ev.restPurges = { status: purgesAdmin.status, body: JSON.stringify(purgesAdmin.json).slice(0, 400) };
      const resolverPurges = await invoke("getVaRecentPurges");
      ev.resolverPurges = JSON.stringify(resolverPurges.json).slice(0, 400);
      if (purgesAdmin.status === 200 && Array.isArray(purgesAdmin.json && purgesAdmin.json.purges)) {
        PASS("GET ?resource=agents&part=purges answers the admin with a purges array", { count: purgesAdmin.json.purges.length, truncated: purgesAdmin.json.truncated });
        const same = JSON.stringify(purgesAdmin.json.purges) === JSON.stringify((resolverPurges.json && resolverPurges.json.purges) || null);
        if (same) PASS("the REST twin and the resolver return the SAME purge list");
        else FAIL("the REST twin and the resolver disagree", { rest: ev.restPurges, resolver: ev.resolverPurges });
      } else {
        FAIL("GET ?resource=agents&part=purges did not answer a purges array", ev.restPurges);
      }
      if (Array.isArray(purgesAdmin.json && purgesAdmin.json.purges) && purgesAdmin.json.purges.length === 0) {
        NV("the purges list is EMPTY, and no door on this build can plant a tombstone carrying turns[].landedWrites - a purge WITH writes is not exercised here");
      }
      const withId = await rest.call("GET", `resource=agents&part=purges&id=${agentId}`);
      if (withId.status === 400) PASS("part=purges refuses an id - it is the one part that is site-wide", { error: withId.json && withId.json.error });
      else FAIL("part=purges accepted an id", { status: withId.status });
    }

    /* ── STEP 5 — the non-admin refusal is a SENTENCE ─────────────────────── */
    console.log("\nSTEP 5 - a non-admin gets the refusal sentence, not a fault");
    const refused = await invoke("getVaRecentPurges", {}, NON_ADMIN);
    ev.nonAdmin = refused.json;
    const ok = refused.status === 200 && refused.json && refused.json.success === false
      && typeof refused.json.error === "string" && /\bpermission\b/i.test(refused.json.error)
      && refused.json.reason === "no-permission";
    if (ok) PASS("getVaRecentPurges refuses a non-admin with a sentence and a reason, at HTTP 200", { error: refused.json.error, reason: refused.json.reason, needsRole: refused.json.needsRole });
    else FAIL("the non-admin answer is not the refusal shape", { status: refused.status, body: JSON.stringify(refused.json).slice(0, 300) });

    const cAfter = await commentTotal();
    if (cAfter.comments === cBefore.comments) PASS("no comment was posted anywhere in the project", { before: cBefore.comments, after: cAfter.comments });
    else FAIL("the project's comment total moved", { before: cBefore, after: cAfter });
  } finally {
    console.log("\nRESTORE");
    if (agentId && !KEEP) {
      await tombstone("clear", agentId);
      const t = await tombstone("read", agentId);
      if (t.json && t.json.row === null) PASS(`the planted tombstone va_purged:${agentId} is GONE (same read saw it above)`);
      else FAIL("the tombstone is still there", { row: t.json && t.json.row });
      await invoke("deleteScheduledJob", { id: agentId });
      const gone = await kvs(`job:${agentId}`);
      if (gone.value === null) PASS(`the agent row job:${agentId} is GONE`);
      else FAIL("the agent row survives the delete", { value: JSON.stringify(gone.value).slice(0, 200) });
    }
    if (rest && rest.id) { await invoke("revokeApiToken", { id: rest.id }); info("the minted REST token was revoked"); }
    if (Object.prototype.hasOwnProperty.call(restore, "agentModelSlot")) {
      await hook({ action: "kvSet", key: AGENT_MODEL_SLOT, value: restore.agentModelSlot === null ? null : restore.agentModelSlot });
      const back = await kvs(AGENT_MODEL_SLOT);
      const same = JSON.stringify(back.value) === JSON.stringify(restore.agentModelSlot);
      if (same) PASS(`${AGENT_MODEL_SLOT} restored to its recorded value`);
      else FAIL(`${AGENT_MODEL_SLOT} was NOT restored`, { now: back.value === null ? "EMPTY" : "(a model id)" });
    }
    fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
    console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/evidence.json`);
  }
}

await main();
process.exit(fails === 0 ? 0 : 1);
