/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-620 (+ F-622 / F-624 / F-625 / F-626) — THE EXISTENCE DOORS, LIVE.
 *
 * THE RULE. For a scope-"own" caller, "that id is free" and "that row is someone
 * else's" must be the SAME answer, byte for byte. Anything less is F-261's oracle:
 * loop over ids, and the refusals map the instance. F-620 re-opened it on the widest
 * door of all — POST ?resource=listeners|jobs, 100 ids per request, refused before any
 * write, so probing costs nothing.
 *
 * HOW A "COLLEAGUE'S ROW" IS MADE WITHOUT A SECOND HUMAN. The only other active account
 * on this site holds no app role (measured: `checkIsAdmin` → role null), so it cannot
 * author anything. But ownership on this surface is a STRING, and an ADMIN token stamps
 * its rows `api:<tokenId>` (F-471) while an EDITOR token stamps the account that minted
 * it. So a row written with an admin token is, to the editor token, exactly what a
 * colleague's row is: a `createdBy` that is not its principal. That is the real product
 * path, not a planted row.
 *
 * WHAT THIS SCRIPT CANNOT DO, AND SAYS SO. F-622/624/625/626 live on RESOLVERS
 * (`saveSkill`, `deleteSkill`, `deleteContextDoc`, `getContextDocContent`). The dev hook
 * lets a driver choose the principal, but its `invokeResolver` allow-list does not carry
 * any of those four function keys — so they are reported NOT VERIFIED, with the measured
 * refusal as the evidence, rather than guessed at.
 *
 * Everything it creates is deleted and proven gone by a second read; both tokens are
 * revoked in the `finally`. No token, URL or secret is ever printed.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";

const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const ENV_NAME = arg("env", "staging");
const HOOK_URL = ENV_NAME === "dev" ? env.TESTSTATE_URL : env.STAGING_TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const OUT = new URL("../results/parity-doors", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: ENV_NAME, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);

const readRes = async (res) => {
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, json: null, text: "" }; }
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
};
async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  return readRes(await fetch(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
const invoke = (functionKey, payload = {}, accountId = ADMIN) => hook({ action: "invokeResolver", functionKey, payload, accountId });

let RULES_URL = null;
const rest = async (token, method, query, body) =>
  readRes(await fetch(`${RULES_URL}?${query}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

/** The whole point: two refusals compared as BYTES, not as a shape. */
function assertIdentical(tag, unknown, foreign) {
  const same = unknown.status === foreign.status && unknown.text === foreign.text;
  if (same) {
    PASS(`${tag}: an unknown id and a colleague's row answer IDENTICALLY (HTTP ${unknown.status}, byte-for-byte)`, { body: unknown.text.slice(0, 140) });
  } else {
    FAIL(`${tag}: the two refusals DIFFER — that is the F-261 oracle`, {
      unknown: { status: unknown.status, body: unknown.text.slice(0, 160) },
      foreign: { status: foreign.status, body: foreign.text.slice(0, 160) },
    });
  }
  return same;
}

async function main() {
  console.log(`\nF-620 — the existence doors, live on ${ENV_NAME.toUpperCase()}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);
  const u = await hook(null, "GET", "?what=rulesApiUrl");
  RULES_URL = u.json && u.json.url;
  if (!RULES_URL) throw new Error("the rules-api URL could not be discovered");

  let adminTok = null, editorTok = null, lstId = null, jobId = null;
  try {
    /* ── STEP 0 — two tokens: one scope-"all", one scope-"own" ────────────── */
    console.log("STEP 0 - one ADMIN token (writes the colleague's rows) and one EDITOR token (the caller under test)");
    const a = await hook({ action: "mintApiToken", name: `parity-admin-${Date.now().toString(36)}` });
    adminTok = { token: a.json && a.json.token, id: a.json && a.json.row && a.json.row.id, role: a.json && a.json.row && a.json.row.role };
    if (!adminTok.token) { FAIL("no admin token could be minted", { body: JSON.stringify(a.json).slice(0, 200) }); return; }
    PASS("an admin-scope token was minted", { id: adminTok.id, role: adminTok.role || "(legacy = scope all)" });
    const e = await invoke("createApiToken", { name: `parity-editor-${Date.now().toString(36)}`, role: "editor" });
    editorTok = { token: e.json && e.json.token, id: e.json && e.json.row && e.json.row.id, role: e.json && e.json.row && e.json.row.role };
    if (!editorTok.token || editorTok.role !== "editor") { FAIL("no EDITOR token could be minted", { body: JSON.stringify(e.json).slice(0, 250) }); return; }
    PASS("an editor-scope token was minted, principal = the harness admin account", { id: editorTok.id, role: editorTok.role });

    /* ── STEP 1 — the colleague's rows, written by the OTHER principal ─────── */
    console.log("\nSTEP 1 - a listener and a job owned by someone who is not the editor token");
    const mkL = await rest(adminTok.token, "POST", "resource=listeners", {
      name: `F-620 colleague listener ${Date.now()}`, events: ["avi:jira:created:issue"], enabled: false,
      mode: "script", functions: [{ name: "noop", code: "api.log('f620 - never runs');" }],
    });
    lstId = mkL.json && (mkL.json.listener ? mkL.json.listener.id : (mkL.json.listeners && mkL.json.listeners[0] && mkL.json.listeners[0].id));
    const mkJ = await rest(adminTok.token, "POST", "resource=jobs", {
      name: `F-620 colleague job ${Date.now()}`, enabled: false, mode: "script",
      schedule: { cron: "0 4 * * *", timeZone: "UTC" }, functions: [{ name: "noop", code: "api.log('f620 - never runs');" }],
    });
    jobId = mkJ.json && (mkJ.json.job ? mkJ.json.job.id : (mkJ.json.jobs && mkJ.json.jobs[0] && mkJ.json.jobs[0].id));
    if (lstId && jobId) PASS("both rows exist", { listener: lstId, job: jobId });
    else { FAIL("the colleague rows could not be created", { listener: JSON.stringify(mkL.json).slice(0, 200), job: JSON.stringify(mkJ.json).slice(0, 200) }); return; }
    /* THE NEGATIVE MUST BE PROVEN ON THE SAME OBJECT: the editor token has to be able
       to SEE this row at all, or "refused" below would prove only that it is blind. */
    const canSee = await rest(editorTok.token, "GET", `resource=listeners&id=${encodeURIComponent(lstId)}`);
    if (canSee.status === 200 && canSee.json && canSee.json.listener && canSee.json.listener.id === lstId) {
      PASS("the EDITOR token can READ that listener (the viewer floor) - so a refusal below is about ownership, not blindness", { createdBy: canSee.json.listener.createdBy });
    } else FAIL("the editor token cannot even read the row - the negatives below would prove nothing", { status: canSee.status, body: canSee.text.slice(0, 160) });
    if (canSee.json && canSee.json.listener && canSee.json.listener.createdBy !== ADMIN) {
      PASS("…and the row is owned by a DIFFERENT principal than the editor token's", { createdBy: canSee.json.listener.createdBy });
    } else FAIL("the row is owned by the editor token's own principal - it is not a colleague's row", { createdBy: canSee.json && canSee.json.listener && canSee.json.listener.createdBy });

    /* ── STEP 2 — THE DOOR. POST with a body id: unknown vs foreign ────────── */
    console.log("\nSTEP 2 - POST ?resource=listeners with a body id: unknown vs a colleague's");
    const freeL = `lst_f620free${Date.now().toString(36)}`;
    const uL = await rest(editorTok.token, "POST", "resource=listeners", { id: freeL, name: "probe", events: ["avi:jira:created:issue"], mode: "script", functions: [{ name: "n", code: "api.log(1);" }] });
    const fL = await rest(editorTok.token, "POST", "resource=listeners", { id: lstId, name: "probe", events: ["avi:jira:created:issue"], mode: "script", functions: [{ name: "n", code: "api.log(1);" }] });
    ev.listeners = { unknown: { status: uL.status, body: uL.text }, foreign: { status: fL.status, body: fL.text } };
    info(`unknown -> ${uL.status} ${uL.text.slice(0, 120)}`);
    info(`foreign -> ${fL.status} ${fL.text.slice(0, 120)}`);
    assertIdentical("listeners POST", uL, fL);
    if (/not-owner|no-permission/.test(uL.text) && !/not found/i.test(uL.text)) PASS("listeners POST: the shared answer is the OWNERSHIP one, and never says 'not found'");
    else FAIL("listeners POST: the shared answer still leaks existence wording", { body: uL.text.slice(0, 160) });

    console.log("\nSTEP 3 - POST ?resource=jobs, the same two probes");
    const freeJ = `job_f620free${Date.now().toString(36)}`;
    const uJ = await rest(editorTok.token, "POST", "resource=jobs", { id: freeJ, name: "probe", mode: "script", schedule: { cron: "0 4 * * *", timeZone: "UTC" }, functions: [{ name: "n", code: "api.log(1);" }] });
    const fJ = await rest(editorTok.token, "POST", "resource=jobs", { id: jobId, name: "probe", mode: "script", schedule: { cron: "0 4 * * *", timeZone: "UTC" }, functions: [{ name: "n", code: "api.log(1);" }] });
    ev.jobs = { unknown: { status: uJ.status, body: uJ.text }, foreign: { status: fJ.status, body: fJ.text } };
    info(`unknown -> ${uJ.status} ${uJ.text.slice(0, 120)}`);
    info(`foreign -> ${fJ.status} ${fJ.text.slice(0, 120)}`);
    assertIdentical("jobs POST", uJ, fJ);

    console.log("\nSTEP 4 - POST ?resource=agents: an ADMIN-floor door, so both ids must die at the ROLE");
    const uA = await rest(editorTok.token, "POST", "resource=agents", { id: `job_f620freeagent${Date.now().toString(36)}`, name: "probe" });
    const fA = await rest(editorTok.token, "POST", "resource=agents", { id: jobId, name: "probe" });
    ev.agents = { unknown: { status: uA.status, body: uA.text }, foreign: { status: fA.status, body: fA.text } };
    info(`unknown -> ${uA.status} ${uA.text.slice(0, 120)}`);
    info(`foreign -> ${fA.status} ${fA.text.slice(0, 120)}`);
    assertIdentical("agents POST", uA, fA);
    if (uA.status === 403 && /needsRole|admin/.test(uA.text)) PASS("agents POST: an editor is stopped at the ADMIN floor before any row is read", { status: uA.status });
    else NV("agents POST: the shared answer is not the admin role floor - worth reading", { status: uA.status, body: uA.text.slice(0, 160) });

    /* ── STEP 5 — the four RESOLVER doors, and why they are not reachable ──── */
    console.log("\nSTEP 5 - the resolver doors (F-622 saveSkill / F-624 deleteSkill / F-625 deleteContextDoc / F-626 getContextDocContent)");
    for (const [fk, finding] of [["saveSkill", "F-622"], ["deleteSkill", "F-624"], ["deleteContextDoc", "F-625"], ["getContextDocContent", "F-626"]]) {
      const r = await invoke(fk, { id: "probe_does_not_exist" });
      const notAllowed = r.status === 400 && r.json && /not allowlisted/.test(String(r.json.error || ""));
      if (notAllowed) NV(`${finding}: ${fk} cannot be driven live - the dev hook's invokeResolver allow-list does not carry it`, { answer: String(r.json.error).slice(0, 90) });
      else info(`${finding}: ${fk} answered ${r.status} ${JSON.stringify(r.json).slice(0, 160)} - reachable, extend this script`);
    }
  } finally {
    console.log("\nRESTORE");
    if (adminTok && adminTok.token) {
      if (lstId) {
        await rest(adminTok.token, "DELETE", `resource=listeners&id=${encodeURIComponent(lstId)}`);
        const back = await rest(adminTok.token, "GET", `resource=listeners&id=${encodeURIComponent(lstId)}`);
        if (back.status === 404) PASS(`the colleague listener ${lstId} is GONE (the same read that returned it now 404s)`);
        else FAIL("the colleague listener survives", { status: back.status });
      }
      if (jobId) {
        await rest(adminTok.token, "DELETE", `resource=jobs&id=${encodeURIComponent(jobId)}`);
        const back = await rest(adminTok.token, "GET", `resource=jobs&id=${encodeURIComponent(jobId)}`);
        if (back.status === 404) PASS(`the colleague job ${jobId} is GONE`);
        else FAIL("the colleague job survives", { status: back.status });
      }
    }
    for (const t of [editorTok, adminTok]) {
      if (t && t.id) { await invoke("revokeApiToken", { id: t.id }); }
    }
    const left = await invoke("getApiTokens", {});
    const live = ((left.json && left.json.tokens) || []).filter((t) => !t.revokedAt && /^parity-(admin|editor)-/.test(t.name || ""));
    if (live.length === 0) PASS("both minted tokens are revoked - a second read of the token list finds none of them live");
    else FAIL("a minted token is still live", { names: live.map((t) => t.name) });
    fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
    console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/evidence.json`);
  }
}

await main();
process.exit(fails === 0 ? 0 : 1);
