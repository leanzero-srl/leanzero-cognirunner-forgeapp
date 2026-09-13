/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE REST DOORS ONTO A VIRTUAL ADMINISTRATOR AND ONTO A LISTENER, LIVE.
 *
 * F-477  a partial `va` in a PUT must be a PATCH (`mergeVaPatch`), not a replacement that
 *        `normalizeVa` rebuilds from `VA_DEFAULTS` - which RESUMED a paused agent and
 *        re-widened every guardrail from a request that only changed a name.
 * F-478  `?resource=jobs` must not be a second, editor-floor door onto an agent: every
 *        route refuses a `mode:"va"` row BY NAME (`is_a_virtual_administrator`) and the
 *        list hides it.
 * F-492  `mergeVaPatch` merges SHAPE, so an explicit `null` sub-object is a LEAF that
 *        REPLACES; `normalizeVa` then reads a null `status` as absent and rebuilds it
 *        from the defaults - `paused:false`. This script sends `{va:{status:null}}` on a
 *        PAUSED agent and records what actually happens.
 * F-471  an EDITOR token's new row records the ACCOUNT that minted the token, not
 *        `api:<tokenId>`; an ADMIN token's records `api:<tokenId>`. The ownership arm
 *        then gates an editor token to its OWN rows.
 * F-490  a POST create naming an EXISTING id is an UN-GATED UPSERT - the only write
 *        route on this surface that asks no ownership question.
 *
 * EVERY refusal is read back with a SECOND GET, and every negative is preceded by the
 * same query succeeding on the same object, so "404" is evidence and not an accident.
 *
 * Usage (from test-harness/):
 *   node scripts/va-rest-doors-live.mjs
 *   node scripts/va-rest-doors-live.mjs --keep
 *
 * Env: TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 * NOTHING secret is printed - not the trigger URLs, not either bearer token.
 */

import { loadEnv, requireEnv } from "../lib/env.mjs";

const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);

const HOOK_URL = env.TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "JT");
const KEEP = flag("keep");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const PASS = (s) => { passes++; console.log(`  PASS  ${s}`); };
const FAIL = (s) => { fails++; console.log(`  FAIL  ${s}`); };
const NV = (s) => { unproven++; console.log(`  N/V   ${s}`); };
const info = (s) => console.log(`        ${s}`);
const REC = (s) => console.log(`  REC   ${s}`);

/* ── cleanup register: everything this run created, removed in the finally ──── */
const cleanup = { agentId: null, listenerIds: [], tokenIds: [] };

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
async function invoke(functionKey, payload = {}, accountId = ADMIN) {
  const r = await hook({ action: "invokeResolver", functionKey, payload, accountId });
  return { status: r.status, body: r.body, raw: r.raw };
}

/* ── the Rules REST API, one call per token ─────────────────────────────────── */
let RULES_URL = null;
async function rest(token, method, query, body) {
  const qs = Object.entries(query).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return readRes(await fetchRetry(`${RULES_URL}?${qs}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

const vaRecord = () => ({
  persona: { name: "Nadia", voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: { serviceDesks: [{ serviceDeskId: "1", queueIds: ["1", "2", "3"] }], jql: `project = ${PROJECT}`, mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: 3, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 5, maxWritesPerRun: 10 },
  status: { paused: true, shadowUntilTick: 3 },
});

const listenerBody = (name) => ({
  name, enabled: false, events: ["avi:jira:commented:issue"],
  filters: { projectKeys: [PROJECT] },
  functions: [{ name: "noop", code: "return api.context.eventType;" }],
});

/*
 * ORDER-INSENSITIVE EQUALITY. The normalizer rebuilds every sub-object with its own key
 * ORDER (and adds defaults such as `powers.confluenceSpaces`), so a raw JSON.stringify
 * comparison reports a rewrite that never happened. F-477 is about VALUES surviving a
 * partial PUT, so the comparison has to be about values: keys sorted, and any key the
 * normalizer ADDED reported separately rather than counted as a change to an old one.
 */
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
};
const sameValues = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
/** Keys present in `after` and not in `before`, and keys whose value CHANGED. */
const deltaOf = (before, after) => {
  const added = Object.keys(after || {}).filter((k) => !(k in (before || {})));
  const changed = Object.keys(before || {}).filter((k) => JSON.stringify(canon(before[k])) !== JSON.stringify(canon(after && after[k])));
  return { added, changed };
};

async function main() {
  console.log("\nVA + LISTENER REST DOORS - live on DEV (F-477 / F-478 / F-492 / F-471 / F-490)\n");

  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable / the secret was rejected (GET -> ${ping.status})`);
  PASS("hook reachable, secret accepted");
  const urlRes = await hook(null, "GET", "?what=rulesApiUrl");
  RULES_URL = urlRes.body && urlRes.body.url;
  if (!RULES_URL) throw new Error(`could not discover the rules-api URL: ${urlRes.status}`);
  PASS("rules-api web-trigger URL discovered (not printed)");

  /* ── STEP 0 — two tokens, two roles ──────────────────────────────────────── */
  console.log("\nSTEP 0 - mint one ADMIN token and one EDITOR token");
  const mk = async (role) => {
    const r = await invoke("createApiToken", { name: `doors-proof ${role} ${Date.now()}`, role });
    if (!(r.body && r.body.success && r.body.token)) throw new Error(`createApiToken(${role}) refused: ${JSON.stringify(r.body).slice(0, 300)}`);
    cleanup.tokenIds.push(r.body.row.id);
    return { token: r.body.token, id: r.body.row.id, row: r.body.row };
  };
  const A = await mk("admin");
  const E = await mk("editor");
  PASS(`admin token minted: id=${A.id} role=${A.row.role} createdBy=${A.row.createdBy}`);
  PASS(`editor token minted: id=${E.id} role=${E.row.role} createdBy=${E.row.createdBy}`);
  const whoA = await rest(A.token, "GET", { resource: "whoami" });
  const whoE = await rest(E.token, "GET", { resource: "whoami" });
  info(`whoami(admin) -> ${JSON.stringify(whoA.body)}`);
  info(`whoami(editor) -> ${JSON.stringify(whoE.body)}`);
  if (whoE.body && whoE.body.createdBy === ADMIN) PASS(`the editor token's createdBy IS the harness admin account (F-471's stamp source)`);
  else NV(`whoami does not expose createdBy: ${JSON.stringify(whoE.body).slice(0, 200)}`);

  /* ── STEP 1 — a PAUSED agent ─────────────────────────────────────────────── */
  console.log("\nSTEP 1 - create a PAUSED Virtual Administrator (through the resolver, as va-shadow-live does)");
  const created = await invoke("saveScheduledJob", { job: { name: "REST doors proof", mode: "va", enabled: true, va: vaRecord() } });
  if (!(created.body && created.body.success)) throw new Error(`saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 400)}`);
  const vaId = created.body.job.id;
  cleanup.agentId = vaId;
  const before = created.body.job.va;
  PASS(`agent ${vaId} created, paused=${before.status.paused}`);
  info(`guardrails before: ${JSON.stringify(before.guardrails)}`);
  info(`persona before: name="${before.persona.name}" voice=${JSON.stringify(before.persona.voice)}`);
  if (before.status.paused !== true) { FAIL("the agent did not save as paused - the F-477/F-492 probes below need a paused agent"); }

  /* ── STEP 2 — F-477: a partial `va` PUT is a PATCH ───────────────────────── */
  console.log("\nSTEP 2 - F-477: PUT ?resource=agents with {va:{persona:{name:\"Ada\"}}} on a PAUSED agent");
  const put1 = await rest(A.token, "PUT", { resource: "agents", id: vaId }, { va: { persona: { name: "Ada" } } });
  info(`PUT -> ${put1.status}`);
  if (put1.status !== 200) { FAIL(`the PUT was refused: ${JSON.stringify(put1.body).slice(0, 300)}`); }
  else {
    // THE SECOND READ - the resolver layer, not the PUT's own echo.
    const back = await invoke("getScheduledJob", { id: vaId });
    const va = back.body && back.body.job && back.body.job.va;
    if (!va) { FAIL("could not read the agent back"); }
    else {
      info(`after the PUT: persona.name="${va.persona.name}" paused=${va.status.paused} shadowUntilTick=${va.status.shadowUntilTick}`);
      info(`guardrails after: ${JSON.stringify(va.guardrails)}`);
      if (va.persona.name === "Ada") PASS('the rename landed: persona.name = "Ada"');
      else FAIL(`the rename did not land: persona.name = "${va.persona.name}"`);
      if (va.status.paused === true) PASS("STILL PAUSED - the partial `va` did not resume the agent (F-477 holds)");
      else FAIL("THE AGENT WAS RESUMED by a rename - F-477 is live");
      for (const [block, b4, af] of [["guardrails", before.guardrails, va.guardrails],
        ["persona.voice", before.persona.voice, va.persona.voice],
        ["powers", before.powers, va.powers],
        ["intake", before.intake, va.intake],
        ["scope", before.scope, va.scope],
        ["cadence", before.cadence, va.cadence]]) {
        const d = deltaOf(b4, af);
        if (!d.changed.length) PASS(`${block}: every value survived the rename${d.added.length ? ` (normalizer ADDED ${JSON.stringify(d.added)}, which is a default and not a rewrite)` : ""}`);
        else FAIL(`${block}: ${JSON.stringify(d.changed)} CHANGED - before ${JSON.stringify(b4)} after ${JSON.stringify(af)}`);
      }
      if (sameValues(before.status, va.status)) PASS("status survived the rename in full");
      else FAIL(`status changed: before ${JSON.stringify(before.status)} after ${JSON.stringify(va.status)}`);
    }
  }

  /* ── STEP 3 — F-478: ?resource=jobs is not a door onto an agent ──────────── */
  console.log("\nSTEP 3 - F-478: the jobs resource must refuse this row BY NAME");
  // THE POSITIVE CONTROL FIRST: prove the jobs door can see a job at all on this token.
  const ctlName = `doors-control ${Date.now()}`;
  const ctl = await rest(A.token, "POST", { resource: "jobs" }, { name: ctlName, enabled: false, mode: "script", schedule: { cron: "0 3 * * *", timeZone: "UTC" }, functions: [{ name: "noop", code: "return 1;" }] });
  const ctlId = ctl.body && ctl.body.job && ctl.body.job.id;
  if (ctlId) {
    const ctlGet = await rest(A.token, "GET", { resource: "jobs", id: ctlId });
    if (ctlGet.status === 200) PASS(`positive control: GET ?resource=jobs&id=<a real script job> -> 200 (the door CAN see a job row)`);
    else FAIL(`the positive control job could not be read back: ${ctlGet.status}`);
  } else { NV(`could not create a control job (${ctl.status} ${JSON.stringify(ctl.body).slice(0, 200)}) - the 404s below are weaker evidence`); }

  for (const [method, label] of [["GET", "GET"], ["PUT", "PUT"], ["DELETE", "DELETE"]]) {
    const r = await rest(A.token, method, { resource: "jobs", id: vaId }, method === "PUT" ? { name: "hijack" } : undefined);
    const reason = r.body && r.body.reason;
    if (r.status === 404 && reason === "is_a_virtual_administrator") PASS(`${label} ?resource=jobs&id=<va> -> 404 reason="is_a_virtual_administrator" resource="${r.body.resource}"`);
    else FAIL(`${label} ?resource=jobs&id=<va> -> ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  }
  const jobsList = await rest(A.token, "GET", { resource: "jobs" });
  const listed = (jobsList.body && jobsList.body.jobs) || [];
  info(`GET ?resource=jobs -> ${listed.length} row(s)`);
  if (ctlId && listed.some((j) => j.id === ctlId)) PASS("the list positive control: the script job IS in the list");
  else if (ctlId) FAIL("the control script job is NOT in the list, so the exclusion below proves nothing");
  if (!listed.some((j) => j.id === vaId)) PASS("the list EXCLUDES the Virtual Administrator");
  else FAIL(`the list includes the VA: ${JSON.stringify(listed.find((j) => j.id === vaId)).slice(0, 200)}`);
  if (listed.some((j) => j && j.mode === "va")) FAIL(`the list leaks ${listed.filter((j) => j.mode === "va").length} other mode:"va" row(s)`);
  else PASS('no mode:"va" row appears anywhere in the list');
  // The agent is still intact after three refused writes.
  const afterDoors = await invoke("getScheduledJob", { id: vaId });
  if (afterDoors.body && afterDoors.body.job) PASS(`the agent survived the refused DELETE: still readable, paused=${afterDoors.body.job.va.status.paused}`);
  else FAIL("the agent is GONE after the refused DELETE on ?resource=jobs");
  if (ctlId) { await rest(A.token, "DELETE", { resource: "jobs", id: ctlId }); info(`control job ${ctlId} deleted`); }

  /* ── STEP 4 — F-492: an explicit null sub-object ─────────────────────────── */
  console.log("\nSTEP 4 - F-492: PUT {va:{status:null}} on the PAUSED agent");
  const pausedNow = afterDoors.body && afterDoors.body.job && afterDoors.body.job.va.status.paused;
  info(`paused before this probe: ${pausedNow}`);
  const put2 = await rest(A.token, "PUT", { resource: "agents", id: vaId }, { va: { status: null } });
  info(`PUT {va:{status:null}} -> ${put2.status}`);
  const back2 = await invoke("getScheduledJob", { id: vaId });
  const va2 = back2.body && back2.body.job && back2.body.job.va;
  info(`status after: ${JSON.stringify(va2 && va2.status)}`);
  if (va2 && va2.status.paused === true) REC("NOT REPRODUCED on this build: the agent is STILL PAUSED after {va:{status:null}}");
  else { REC(`REPRODUCED: paused went ${pausedNow} -> ${va2 && va2.status.paused} from an explicit null sub-object (F-492)`); }
  info(`shadowUntilTick after: ${va2 && va2.status.shadowUntilTick} (was ${before.status.shadowUntilTick})`);
  if (va2 && va2.status.paused !== true) {
    const repause = await rest(A.token, "PUT", { resource: "agents", id: vaId }, { va: { status: { paused: true, shadowUntilTick: before.status.shadowUntilTick } } });
    const back3 = await invoke("getScheduledJob", { id: vaId });
    const ok = back3.body && back3.body.job && back3.body.job.va.status.paused === true;
    if (ok) PASS(`RESTORED: the agent is paused again (repause PUT ${repause.status})`);
    else FAIL(`could not re-pause the agent: ${JSON.stringify(back3.body && back3.body.job && back3.body.job.va.status)}`);
  }

  /* ── STEP 5 — F-471: who a new row belongs to ───────────────────────────── */
  console.log("\nSTEP 5 - F-471: the createdBy stamp, and the ownership gate");
  const mkListener = async (tok, name) => {
    const r = await rest(tok, "POST", { resource: "listeners" }, listenerBody(name));
    const row = r.body && r.body.listener;
    if (row && row.id) cleanup.listenerIds.push(row.id);
    return { status: r.status, row, body: r.body };
  };
  const byEditor = await mkListener(E.token, `doors editor ${Date.now()}`);
  const byAdmin = await mkListener(A.token, `doors admin ${Date.now()}`);
  if (!byEditor.row || !byAdmin.row) { FAIL(`could not create the two listeners: editor ${byEditor.status} ${JSON.stringify(byEditor.body).slice(0, 200)} / admin ${byAdmin.status}`); }
  else {
    info(`editor-created row ${byEditor.row.id} createdBy="${byEditor.row.createdBy}" savedByRole="${byEditor.row.savedByRole}"`);
    info(`admin-created  row ${byAdmin.row.id} createdBy="${byAdmin.row.createdBy}" savedByRole="${byAdmin.row.savedByRole}"`);
    if (byEditor.row.createdBy === ADMIN) PASS(`the EDITOR token's row records the minting ACCOUNT (${ADMIN.slice(0, 12)}…), not api:<tokenId>`);
    else FAIL(`the editor token's row records createdBy="${byEditor.row.createdBy}" - expected the minting account`);
    if (byAdmin.row.createdBy === `api:${A.id}`) PASS(`the ADMIN token's row records api:<tokenId>`);
    else FAIL(`the admin token's row records createdBy="${byAdmin.row.createdBy}" - expected api:${A.id}`);

    // The ownership gate, both directions, on the SAME token.
    const own = await rest(E.token, "PUT", { resource: "listeners", id: byEditor.row.id }, { name: "editor renamed its own" });
    if (own.status === 200) PASS(`the editor token CAN edit its OWN row -> 200 (the positive control for the 403 below)`);
    else FAIL(`the editor token could not edit its own row: ${own.status} ${JSON.stringify(own.body).slice(0, 250)}`);
    /*
     * THE OWNERSHIP ARM, AND WHY IT CANNOT FIRE HERE.
     *
     * `ownerGate` asks `gateExistingRow(who.createdBy, row)`, and `rowGateVerdict`
     * short-circuits on `perms.role === "admin" || perms.scope === "all"`. `createApiToken`
     * is `requireAdmin`, so the account that mints ANY token is an app admin at mint
     * time - which makes an editor token's OWNING PRINCIPAL a scope-"all" caller and
     * the ownership arm unreachable. The role read below is the evidence, not a guess:
     * the expected answer is derived from what the instance says the account is.
     */
    const perms = await invoke("checkIsAdmin", {});
    const ownerRole = perms.body && perms.body.role;
    const ownerScope = perms.body && perms.body.scope;
    info(`the token's owning account resolves to role="${ownerRole}" scope="${ownerScope}"`);
    const other = await rest(E.token, "PUT", { resource: "listeners", id: byAdmin.row.id }, { name: "editor tried the admin's" });
    const seesEverything = ownerRole === "admin" || ownerScope === "all";
    if (!seesEverything) {
      if (other.status === 403 && other.body && other.body.hint === "not-owner") PASS(`the editor token CANNOT edit the admin's row -> 403 hint="not-owner"`);
      else FAIL(`the editor token's PUT on the admin's row -> ${other.status} ${JSON.stringify(other.body).slice(0, 250)}`);
    } else if (other.status === 200) {
      REC(`NOT REFUSED, and it CANNOT be on this instance: the editor token's owning account is role="${ownerRole}" scope="${ownerScope}", so rowGateVerdict's seesEverything arm allows every row. The PUT on the ADMIN token's row returned 200.`);
      NV(`F-471's ownership arm (403 hint:"not-owner") is NOT EXERCISABLE through a token here: every token's owner is an app admin, because createApiToken is requireAdmin. Proving the refusal needs a token whose minting account was afterwards demoted to editor with scope "own".`);
    } else {
      FAIL(`the editor token's PUT on the admin's row -> ${other.status} (expected 200 for a scope-all owner): ${JSON.stringify(other.body).slice(0, 250)}`);
    }
    // THE OWNERSHIP RE-STAMP, which is documented behaviour in src/listeners.js
    // ("createdBy is NOT first author - it is the account whose authority the rule runs
    // as") and is recorded here because it is what turns the F-490 upsert into an
    // ownership transfer rather than just a rewrite.
    const reread = await rest(A.token, "GET", { resource: "listeners", id: byAdmin.row.id });
    const nowOwner = reread.body && reread.body.listener && reread.body.listener.createdBy;
    if (nowOwner !== `api:${A.id}`) REC(`the successful PUT RE-STAMPED ownership: createdBy went "api:${A.id}" -> "${nowOwner}" (documented in src/listeners.js: createdBy is the authority the rule runs as, not its first author)`);
    else info(`createdBy is unchanged after the PUT: "${nowOwner}"`);

    /* ── F-490 — the POST that names somebody else's id ───────────────────── */
    console.log("\nSTEP 6 - F-490: POST ?resource=listeners with a body id naming the ADMIN's row, from the EDITOR token");
    const adminBefore = await rest(A.token, "GET", { resource: "listeners", id: byAdmin.row.id });
    const nameBefore = adminBefore.body && adminBefore.body.listener && adminBefore.body.listener.name;
    const createdByBefore = adminBefore.body && adminBefore.body.listener && adminBefore.body.listener.createdBy;
    info(`the admin's row before: name="${nameBefore}" createdBy="${createdByBefore}"`);
    const upsert = await rest(E.token, "POST", { resource: "listeners" }, { ...listenerBody("HIJACKED BY THE EDITOR TOKEN"), id: byAdmin.row.id });
    info(`POST with body id -> ${upsert.status}`);
    const adminAfter = await rest(A.token, "GET", { resource: "listeners", id: byAdmin.row.id });
    const rowAfter = adminAfter.body && adminAfter.body.listener;
    info(`the admin's row after: name="${rowAfter && rowAfter.name}" createdBy="${rowAfter && rowAfter.createdBy}"`);
    if (rowAfter && rowAfter.name === nameBefore) REC("NOT REPRODUCED: the POST did not overwrite the admin's row");
    else REC(`REPRODUCED (F-490): an un-gated UPSERT - the editor token rewrote the admin's row through POST ("${nameBefore}" -> "${rowAfter && rowAfter.name}"), through a route that asks no ownership question at all - the PUT route at least ASKS (\`ownerGate\`), this one never does`);
    // RESTORE the row to what it was.
    if (rowAfter && rowAfter.name !== nameBefore) {
      const fix = await rest(A.token, "PUT", { resource: "listeners", id: byAdmin.row.id }, { name: nameBefore });
      const chk = await rest(A.token, "GET", { resource: "listeners", id: byAdmin.row.id });
      const n = chk.body && chk.body.listener && chk.body.listener.name;
      if (n === nameBefore) PASS(`RESTORED: the admin's row is named "${nameBefore}" again (PUT ${fix.status})`);
      else FAIL(`could not restore the admin's row: name is now "${n}"`);
    }
  }

  console.log(`\nRESULT - ${passes} pass, ${fails} fail, ${unproven} not verified (REC lines are recorded observations, not assertions)`);
  if (fails) process.exitCode = 1;
}

main()
  .catch((e) => { console.error("\nDRIVER ERROR:", e && e.message); process.exitCode = 1; })
  /*
   * CLEANUP IS AN ASSERTION. A delete resolver's own `success:true` / `removed:true` is
   * the same class of evidence as "the step returned success" — it is the writer's
   * opinion of its own write. Every removal below is therefore RE-READ through a
   * different call (getListener / getScheduledJob / getApiTokens) and a survivor makes
   * the process exit non-zero with the phase named, instead of scrolling past.
   */
  .finally(async () => {
    if (KEEP) { console.log("\nCLEANUP SKIPPED (--keep)"); return; }
    console.log("\nCLEANUP");
    const residue = [];
    for (const id of cleanup.listenerIds) {
      const r = await invoke("deleteListener", { id }).catch((e) => ({ body: { error: e.message } }));
      console.log(`        deleteListener ${id}: ${JSON.stringify(r.body).slice(0, 120)}`);
      const back = await invoke("getListener", { id }).catch(() => null);
      const still = !!(back && back.body && back.body.listener);
      console.log(`        second read getListener ${id}: ${still ? "STILL PRESENT" : "gone"}`);
      if (still) residue.push(`listener ${id}`);
    }
    if (cleanup.agentId) {
      const id = cleanup.agentId;
      const r = await invoke("deleteScheduledJob", { id }).catch((e) => ({ body: { error: e.message } }));
      console.log(`        deleteScheduledJob ${id}: ${JSON.stringify(r.body).slice(0, 120)}`);
      const back = await invoke("getScheduledJob", { id }).catch(() => null);
      const still = !!(back && back.body && back.body.job);
      console.log(`        second read getScheduledJob ${id}: ${still ? "STILL PRESENT" : "gone"}`);
      if (still) residue.push(`agent ${id}`);
    }
    for (const id of cleanup.tokenIds) {
      const r = await invoke("revokeApiToken", { id }).catch((e) => ({ body: { error: e.message } }));
      console.log(`        revokeApiToken ${id}: ${JSON.stringify(r.body).slice(0, 120)}`);
    }
    const left = await invoke("getApiTokens", {}).catch(() => null);
    const rows = (left && left.body && left.body.tokens) || [];
    if (cleanup.tokenIds.length) {
      if (!rows.length) {
        // PROVE THE NEGATIVE: an empty list is not evidence of revocation if the read
        // cannot see tokens at all. It saw them at mint time only through createApiToken.
        console.log("        getApiTokens returned NO rows at all — cannot judge revocation from an empty list");
        residue.push(`token revocation unproven (getApiTokens returned nothing; ids ${cleanup.tokenIds.join(", ")})`);
      } else {
        const live = cleanup.tokenIds.filter((id) => rows.some((t) => t.id === id && !t.revokedAt));
        console.log(`        second read getApiTokens: ${rows.length} row(s); ours still live: ${live.join(", ") || "none"}`);
        if (live.length) residue.push(`api token(s) ${live.join(", ")}`);
      }
    }
    console.log(`        API tokens still live overall: ${rows.filter((t) => !t.revokedAt).length}`);
    if (residue.length) {
      console.error(`\nCLEANUP FAILED — these objects survived their delete and are still live on the instance:\n        ${residue.join("\n        ")}`);
      process.exitCode = 1;
    }
  });
