/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-628 — THE PURGE PANEL, RENDERED FROM REAL DATA AT LAST.
 *
 * `va-settling-carrier-live.mjs` proved everything about F-608's panel EXCEPT the one
 * sentence it exists to print. `getVaRecentPurges` and `GET ?resource=agents&part=purges`
 * both answered `{purges: [], truncated: false}` on staging and always would: a row is
 * returned only when `turns[].landedWrites` is non-empty, and the sole producer of that
 * field is `recordPurgedTurnWrites` running inside a turn that is writing to Jira at the
 * instant the agent is deleted — a race a driver cannot schedule. An empty list is not
 * evidence that a populated one would render.
 *
 * So `vaTombstone plant` now takes a bounded `turns` array and writes it THROUGH THE SAME
 * WRITER the engine uses. This driver plants it and then asks the PRODUCT: the admin
 * resolver, the REST door and the non-admin refusal, in that order, with an empty read
 * before and after so neither the positive nor the negative is a query that could only
 * ever have answered one way.
 *
 * NOTHING IS TICKED AND NOTHING IS POSTED. The tombstone is hung on a DISABLED SCRIPT job
 * — `vaTombstone` requires a job row only so it cannot plant unreachable litter, and the
 * panel projects the tombstone, not the job — so no agent is created, no model is called
 * and no capability flag is touched. The job and the tombstone are both removed in the
 * `finally`, each proven gone by a re-read.
 *
 * Usage (from test-harness/):  node scripts/va-purge-carrier-live.mjs [--env=staging|dev] [--keep]
 * Env: STAGING_TESTSTATE_URL (or TESTSTATE_URL) + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 * Nothing secret is printed: not the secret, not the trigger URL, not the REST token.
 */
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { formatResultLine, resultExitCode, runProvenance } from "../lib/driver-report.mjs";

const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["agents", "jobs", "kvs"], defaultEnv: "staging" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const NON_ADMIN = "712020:00000000-0000-0000-0000-000000000000"; // an account that is nobody here
const PROJECT = arg("project", "LZPT");
const KEEP = flag("keep");
const OUT = new URL("../results/va-purge-carrier", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let passes = 0, fails = 0, unproven = 0;
let crashed = null;   /* F-792 — set by main()'s catch; the RESULT line reads it */
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
const mine = (body, agent) => ((body && body.purges) || []).find((p) => p.agent === agent) || null;

async function restApi() {
  const u = await hook(null, "GET", "?what=rulesApiUrl");
  const url = u.json && u.json.url;
  if (!url) return null;
  const t = await hook({ action: "mintApiToken", name: `purge-carrier-${Date.now().toString(36)}` });
  const token = t.json && t.json.token;
  if (!token) return null;
  return {
    id: (t.json.row && t.json.row.id) || null,
    call: async (method, query, body) => readRes(await fetch(`${url}?${query}`, {
      method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })),
  };
}

/* The writes the panel will print. Short, obviously synthetic, and named so a reader of
   the tab can tell at a glance that no customer issue was touched by this run. */
const TURNS = [
  { at: new Date(Date.now() - 4 * 60 * 1000).toISOString(), issueKey: `${PROJECT}-1`, writes: ["add_comment", "transition to Done"] },
  { at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), issueKey: `${PROJECT}-2`, writes: ["add_comment"] },
];
const EXPECTED_WRITES = TURNS.reduce((n, t) => n + t.writes.length, 0);

async function main() {
  console.log(`\nF-628 — the purge panel, from real engine data, on ${ENV_NAME.toUpperCase()}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  let jobId = null;
  let rest = null;
  try {
    /* ── STEP 1 — a disabled script job to hang the tombstone on ──────────── */
    console.log("STEP 1 - a DISABLED script job (no agent, no model, no tick)");
    const created = await invoke("saveScheduledJob", {
      job: {
        name: `F-628 purge carrier ${Date.now()}`,
        mode: "script",
        enabled: false,
        schedule: { cron: "0 4 * * *", timeZone: "UTC" },
        functions: [{ name: "noop", code: "api.log('f628 carrier - never runs');" }],
      },
    });
    if (!(created.json && created.json.success)) throw new Error(`saveScheduledJob refused: ${JSON.stringify(created.json).slice(0, 300)}`);
    jobId = created.json.job.id;
    PASS(`job ${jobId} created, disabled`, { enabled: created.json.job.enabled });

    /* ── STEP 2 — the NEGATIVE, on the SAME resolver that must show it later ─ */
    console.log("\nSTEP 2 - the panel does NOT list this agent before anything is planted (the control)");
    const before = await invoke("getVaRecentPurges");
    ev.before = before.json;
    if (before.json && before.json.success !== false && Array.isArray(before.json.purges)) {
      PASS("getVaRecentPurges answers a purges array for an admin - the control is a real read", { count: before.json.purges.length, truncated: before.json.truncated });
    } else {
      FAIL("getVaRecentPurges did not answer a purges array", { body: JSON.stringify(before.json).slice(0, 300) });
      return;
    }
    if (!mine(before.json, jobId)) PASS("…and it does not carry this agent yet");
    else FAIL("the panel already lists this agent before the plant", mine(before.json, jobId));

    /* ── STEP 3 — plant the tombstone WITH turns, through the engine's writer ─ */
    console.log("\nSTEP 3 - plant the tombstone and the landed writes (recordPurgedTurnWrites, the product's own writer)");
    const planted = await tombstone("plant", jobId, { turns: TURNS });
    ev.planted = planted.json;
    if (!(planted.json && planted.json.ok)) { FAIL("the plant was refused", { status: planted.status, body: JSON.stringify(planted.json).slice(0, 300) }); return; }
    PASS(`va_purged:${jobId} planted with ${TURNS.length} turns`, { at: planted.json.row.at, clamped: planted.json.clampedToCreatedAt });
    if (Array.isArray(planted.json.noted) && planted.json.noted.every((n) => n.ok === true)) {
      PASS("…and the PRODUCT writer accepted every turn - this is the engine's own answer, not the hook's", { noted: planted.json.noted });
    } else FAIL("the product writer refused a turn", { noted: planted.json.noted });
    const rowKv = await kvs(`va_purged:${jobId}`);
    const turnsOnRow = (rowKv.value && rowKv.value.turns) || [];
    if (turnsOnRow.length === TURNS.length && turnsOnRow.every((t) => Array.isArray(t.landedWrites) && t.landedWrites.length)) {
      PASS("…and the stored row carries `turns[].landedWrites` - the field name the ENGINE writes", { turns: turnsOnRow.length });
    } else FAIL("the stored row does not carry the engine's turns shape", { turns: turnsOnRow });

    /* ── STEP 4 — THE SENTENCE. The resolver the Agents tab reads. ─────────── */
    console.log("\nSTEP 4 - the one sentence F-608's panel exists to print");
    const after = await invoke("getVaRecentPurges");
    ev.after = after.json;
    const row = mine(after.json, jobId);
    if (row) PASS("getVaRecentPurges RETURNS this agent - a populated purge panel, live, for the first time", { agent: row.agent, purgedAt: row.purgedAt });
    else { FAIL("the panel still does not list the agent after the plant", { body: JSON.stringify(after.json).slice(0, 400) }); return; }
    if (row.writeCount === EXPECTED_WRITES) PASS(`…with the write count the copy prints ("wrote ${EXPECTED_WRITES} times while you were deleting it")`, { writeCount: row.writeCount });
    else FAIL("the write count is not what was planted", { expected: EXPECTED_WRITES, got: row.writeCount });
    const t0 = (row.turns || [])[0];
    if (t0 && Array.isArray(t0.writes) && t0.writes.includes("add_comment") && t0.issueKey === `${PROJECT}-1`) {
      PASS("…and the per-turn issue key and REAL write strings reach the surface", { issueKey: t0.issueKey, writes: t0.writes });
    } else FAIL("the projected turn does not carry the planted issue key and writes", { turn: t0 });
    if (typeof row.purgedAt === "string" && Number.isFinite(Date.parse(row.purgedAt))) PASS("…and a purge time the section can date the row by", { purgedAt: row.purgedAt });
    else FAIL("purgedAt is not a usable timestamp", { purgedAt: row.purgedAt });

    /* ── STEP 5 — the REST twin answers the same thing ─────────────────────── */
    console.log("\nSTEP 5 - GET ?resource=agents&part=purges answers the same body");
    rest = await restApi();
    if (!rest) { NV("no REST URL or token could be obtained; the REST twin is not exercised"); }
    else {
      const r = await rest.call("GET", "resource=agents&part=purges");
      ev.rest = r.json;
      const restRow = mine(r.json, jobId);
      if (r.status === 200 && restRow && restRow.writeCount === EXPECTED_WRITES) {
        PASS("the REST door carries the same populated row", { status: r.status, writeCount: restRow.writeCount });
      } else FAIL("the REST door did not answer the populated row", { status: r.status, body: JSON.stringify(r.json).slice(0, 300) });
      const withId = await rest.call("GET", `resource=agents&part=purges&id=${jobId}`);
      if (withId.status === 400) PASS("…and still refuses an id - purges is the one part that is site-wide", { error: withId.json && withId.json.error });
      else FAIL("part=purges accepted an id", { status: withId.status });
    }

    /* ── STEP 6 — the non-admin refusal is a SENTENCE, even with data present ─ */
    console.log("\nSTEP 6 - a non-admin is refused, and is not told what is in the panel");
    const refused = await invoke("getVaRecentPurges", {}, NON_ADMIN);
    ev.nonAdmin = refused.json;
    const j = refused.json;
    if (j && j.success === false && j.reason === "no-permission" && typeof j.error === "string" && /\bpermission\b/i.test(j.error)) {
      PASS("getVaRecentPurges refuses a non-admin with a sentence and a reason, at HTTP 200", { reason: j.reason, needsRole: j.needsRole });
    } else FAIL("the non-admin answer is not the refusal shape", { status: refused.status, body: JSON.stringify(j).slice(0, 300) });
    if (!j || j.purges === undefined) PASS("…and carries no purges at all - the refusal leaks nothing about who wrote what");
    else FAIL("the refusal leaked the purges list", { purges: j.purges });

    /* ── STEP 7 — the secret guard on this door too ────────────────────────── */
    console.log("\nSTEP 7 - the plant door refuses a body that names a credential");
    const leak = await tombstone("plant", jobId, { turns: [{ writes: ["add_comment"], token: "ghp_notarealtoken1234" }] });
    ev.secretRefusal = leak.json;
    if (leak.status === 400 && leak.json && leak.json.harnessRefusal === "secret-field") {
      PASS("a plant body carrying a token is refused secret-field", { field: leak.json.field });
    } else FAIL("the secret guard did not refuse", { status: leak.status, body: JSON.stringify(leak.json).slice(0, 200) });
  } catch (e) {
    /* F-792 — the RESULT line below prints from the `finally`, so the RESTORE block can report
       its own residue after it. That also means it prints on the CRASH path, with the counters
       frozen wherever the throw left them — which is how a dead run says "0 fail". Catching
       here is what lets the line SAY it crashed. Deliberately no rethrow: the finally's restore
       and its residue assertions must still run and still be the last word. */
    crashed = e;
    console.error("\nDRIVER ERROR:", e && e.stack);
  } finally {
    /* ── RESTORE — and the SECOND read, which is what proves the first one ── */
    console.log("\nRESTORE");
    if (jobId && !KEEP) {
      await tombstone("clear", jobId);
      const t = await tombstone("read", jobId);
      if (t.json && t.json.row === null) PASS(`the planted tombstone va_purged:${jobId} is GONE`);
      else FAIL("the tombstone is still there", { row: t.json && t.json.row });
      const gone = await invoke("getVaRecentPurges");
      if (!mine(gone.json, jobId)) PASS("…and the panel no longer lists the agent - the same read that showed it above now does not");
      else FAIL("the panel still lists the agent after the clear", mine(gone.json, jobId));
      await invoke("deleteScheduledJob", { id: jobId });
      const row = await kvs(`job:${jobId}`);
      if (row.value === null) PASS(`the job row job:${jobId} is GONE`);
      else FAIL("the job row survives the delete", { value: JSON.stringify(row.value).slice(0, 200) });
    } else if (jobId) {
      NV("--keep: the planted tombstone and the job were left in place");
    }
    if (rest && rest.id) { await invoke("revokeApiToken", { id: rest.id }); info("the minted REST token was revoked"); }
    /* F-787 — WHICH COMMIT PRODUCED THIS FILE. Evidence is read weeks later beside a findings row; `dirty` is reported because evidence made from uncommitted edits is not reproducible from the commit it names. */
    ev.provenance = runProvenance();
    fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
    console.log("\n" + formatResultLine({ passes, fails, unproven, crashed, suffix: `. Evidence: ${OUT}/evidence.json` }));
  }
}

await main();
process.exit(resultExitCode({ fails, crashed }));
