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
 * F-503  the token's EFFECTIVE permissions, not its minter's: an EDITOR token resolves
 *        to role=min(stamp, minter's live role) and scope="own", so the ownership arm
 *        that F-471 could never reach through a token (every minter is an app admin,
 *        because createApiToken is requireAdmin) is finally EXERCISABLE. The STEP 5 arm
 *        below therefore asserts 403 hint:"not-owner" outright instead of recording a
 *        200 it could not call wrong.
 * F-493  the create route re-reads the owning account's LIVE role.
 * F-485  the SAVE door refuses a `mode:"va"` row on an instance whose capability is off
 *        (`agent_capability_off`, `agentDisabled:true`). On such an instance NO agent can
 *        be created at all, so the agent arms below (F-477/F-478/F-492/F-508) are
 *        reported NOT VERIFIED rather than skipped silently - run with --env=staging and
 *        the agent model on a frontier model to exercise them.
 * F-508  `status.shadowUntilTick` is clamped to [0, MAX_SAFE_INTEGER] by `normalizeVa`,
 *        so a PUT of 500 is RECORDED here, whatever it turns out to be - this build is
 *        the before-picture.
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

import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { loadEnv, requireEnv } from "../lib/env.mjs";

const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], defaultEnv: "dev" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);

const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "JT");
const KEEP = flag("keep");
const FLIP_MODEL = flag("flip-model");
const FRONTIER = arg("model", "claude-sonnet-5");

/*
 * THE AGENT-MODEL SLOT, and why the restore replays the SLOT and not the resolver.
 *
 * Ported verbatim in intent from va-purge-on-delete-live.mjs (F-485's own note): the
 * resolver answers a FALLBACK when the slot is empty, and `saveAgentModel` then refuses
 * to write back a non-frontier value - so restoring "what the resolver said" leaves the
 * slot dirty. What is recorded and replayed is the KVS SLOT itself, through the hook's
 * `kvSet`, whose allow-list already carries this key.
 */
const AGENT_MODEL_SLOT = "COGNIRUNNER_AGENT_MODEL_atlassian";
let agentModelSlotBefore;   // `undefined` = never touched, so the finally must not write

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
/** Read ONE KVS row through the hook's unrestricted GET read. `null` = absent. */
async function kvs(key) {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`);
  if (r.status !== 200 || !r.body) return { ok: false, value: null, status: r.status };
  return { ok: true, value: r.body.value === undefined ? null : r.body.value };
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
  console.log(`\nVA + LISTENER REST DOORS - live on ${ENV_NAME.toUpperCase()} (F-477 / F-478 / F-492 / F-471 / F-490 / F-503 / F-493 / F-485 / F-508)\n`);
  if (!HOOK_URL) throw new Error(`no web-trigger URL configured for environment "${ENV_NAME}"`);

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
  // `whoami` answers `{token:{…}}` (`publicRow(who)` under a `token` key in src/rules-api.js),
  // so the stamp lives at `body.token.createdBy`. Reading it off the top level reported a
  // false NOT VERIFIED against a body that was printed one line above holding the value.
  const whoECreatedBy = whoE.body && whoE.body.token && whoE.body.token.createdBy;
  if (whoECreatedBy === ADMIN) PASS(`the editor token's createdBy IS the harness admin account (F-471's stamp source)`);
  else FAIL(`whoami reports createdBy="${whoECreatedBy}" - expected the harness admin account`);

  /* ── STEP 1 — a PAUSED agent, IF the instance can hold one at all ────────── */
  console.log("\nSTEP 1 - F-485: create a PAUSED Virtual Administrator (through the resolver, as va-shadow-live does)");
  if (FLIP_MODEL) {
    const slot = await kvs(AGENT_MODEL_SLOT);
    agentModelSlotBefore = slot.value;
    info(`${AGENT_MODEL_SLOT} before: ${slot.value === null ? "EMPTY (the resolver answers a fallback)" : JSON.stringify(slot.value)} - the SLOT is what the finally replays`);
    const set = await invoke("saveAgentModel", { model: FRONTIER });
    if (set.body && set.body.success) PASS(`agent model flipped to "${FRONTIER}" for this run`);
    else FAIL(`saveAgentModel("${FRONTIER}") refused: ${JSON.stringify(set.body).slice(0, 300)}`);
  }
  const capRead = await invoke("getAgentCapability", {});
  const cap = capRead.body || {};
  info(`getAgentCapability -> enabled=${cap.enabled} reason="${cap.reason}" edition=${cap.edition} provider=${cap.provider} agentModel=${cap.agentModel}`);
  const created = await invoke("saveScheduledJob", { job: { name: "REST doors proof", mode: "va", enabled: true, va: vaRecord() } });
  const saved = created.body && created.body.success === true;

  /*
   * F-485 — THE SAVE DOOR IS THE GATE NOW, and the two answers are read against the
   * capability the instance ITSELF reported a line earlier, not against a constant.
   * An incapable instance that ACCEPTS the save is the defect F-485 closed; a capable
   * instance that REFUSES it is a regression in the other direction. Both are FAILs,
   * so this is an assertion and not a branch that always passes.
   */
  if (cap.enabled !== true) {
    if (saved) {
      FAIL(`F-485 REGRESSED: capability is OFF ("${cap.reason}") and saveScheduledJob still created the agent`);
    } else {
      const b = created.body || {};
      const refusedRow = Array.isArray(b.refused) ? b.refused[0] : null;
      if (b.reason === "agent_capability_off") PASS(`the save is REFUSED at the resolver: reason="agent_capability_off"`);
      else FAIL(`the save was refused with reason="${b.reason}" - expected "agent_capability_off": ${JSON.stringify(b).slice(0, 300)}`);
      if (b.agentDisabled === true) PASS("the refusal carries agentDisabled:true");
      else FAIL(`agentDisabled=${b.agentDisabled}`);
      if (b.capability && b.capability.enabled === false && b.capability.reason === cap.reason) PASS(`the refusal echoes the instance's OWN capability verdict: {enabled:false, reason:"${b.capability.reason}"}`);
      else FAIL(`capability in the refusal is ${JSON.stringify(b.capability)} - the instance reported reason="${cap.reason}"`);
      if (refusedRow && refusedRow.field === "va" && refusedRow.reason === cap.reason) PASS(`refused[] names the field and the reason: ${JSON.stringify(refusedRow)}`);
      else FAIL(`refused[] is ${JSON.stringify(b.refused)}`);
      if (typeof b.error === "string" && b.error.length > 40 && !b.error.includes("[object Object]")) PASS(`the sentence is rendered prose, no "[object Object]": "${b.error.slice(0, 120)}…"`);
      else FAIL(`the refusal sentence is malformed: ${JSON.stringify(b.error)}`);
    }
    // THE SECOND READ. A refusal that still wrote the row is the worst of both answers.
    const listNow = await invoke("listVaAgents", {});
    const rows = (listNow.body && listNow.body.agents) || [];
    if (!rows.some((a) => a && a.name === "REST doors proof")) PASS(`SECOND READ: listVaAgents holds no "REST doors proof" row - the refusal wrote nothing (${rows.length} agent(s) on the instance)`);
    else FAIL(`the refused save LEFT A ROW BEHIND: ${JSON.stringify(rows.find((a) => a.name === "REST doors proof")).slice(0, 200)}`);

    /* ── F-485 through the REST door too: POST ?resource=agents -> 409 ──────── */
    console.log("\nSTEP 1b - F-485 over REST: POST ?resource=agents on the same incapable instance");
    const restPost = await rest(A.token, "POST", { resource: "agents" }, { name: "REST doors proof (rest)", enabled: true, va: vaRecord() });
    info(`POST ?resource=agents -> ${restPost.status} ${JSON.stringify(restPost.body).slice(0, 300)}`);
    if (restPost.status === 409) PASS(`the REST door answers 409 CONFLICT (not 400): nothing in the body would fix an instance-level refusal`);
    else FAIL(`POST ?resource=agents -> ${restPost.status}, expected 409`);
    if (restPost.body && restPost.body.reason === "agent_capability_off") PASS(`the REST refusal carries reason="agent_capability_off"`);
    else FAIL(`reason="${restPost.body && restPost.body.reason}"`);
    if (restPost.body && restPost.body.agentDisabled === true) PASS("the REST refusal carries agentDisabled:true");
    else FAIL(`agentDisabled=${restPost.body && restPost.body.agentDisabled}`);
    // POSITIVE CONTROL: the same token on the same resource CAN be answered 200 - so the
    // 409 is an answer about the instance, not a dead route.
    const agentsList = await rest(A.token, "GET", { resource: "agents" });
    if (agentsList.status === 200) PASS(`positive control: GET ?resource=agents -> 200 on the SAME token (${((agentsList.body && agentsList.body.agents) || []).length} agent(s)) - the resource is alive, the 409 is about the INSTANCE`);
    else FAIL(`the agents resource is not readable at all: ${agentsList.status} - the 409 above proves nothing`);
  } else if (!saved) {
    FAIL(`capability is ON ("${cap.reason || "enabled"}") but saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 400)}`);
  }

  const vaId = saved ? created.body.job.id : null;
  const before = saved ? created.body.job.va : null;
  if (saved) cleanup.agentId = vaId;
  if (!vaId) {
    NV(`the agent arms (F-477 partial-PUT, F-478 the jobs door, F-492 the null sub-object, F-508 shadowUntilTick) CANNOT run on ${ENV_NAME}: F-485 refuses the creation of any Virtual Administrator here ("${cap.reason}"). Re-run with --env=staging and a frontier agent model.`);
  }
  if (vaId) {
    PASS(`agent ${vaId} created, paused=${before.status.paused}`);
    info(`guardrails before: ${JSON.stringify(before.guardrails)}`);
    info(`persona before: name="${before.persona.name}" voice=${JSON.stringify(before.persona.voice)}`);
    if (before.status.paused !== true) { FAIL("the agent did not save as paused - the F-477/F-492 probes below need a paused agent"); }
  }

  if (vaId) {
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


    /* ── STEP 4a — F-492, the GUARDRAIL half: an explicit null LEAF ──────────
     *
     * `{va:{status:null}}` above asks whether a null SUB-OBJECT resurrects a default.
     * This asks the same question of a null LEAF inside a sub-object that is otherwise
     * present, on the field where getting it wrong is worst: a TIGHTENED cap. The agent
     * is first narrowed to capsPerHour = 1 (well below the VA_DEFAULTS value), and then
     * a PUT sends `{va:{guardrails:{capsPerHour:null}}}`. `mergeVaPatch` treats null as
     * "keep existing", so the tightening must SURVIVE. A re-widened cap here would be an
     * agent posting more often than the admin allowed, from a request that asked for
     * nothing at all.
     */
    console.log("\nSTEP 4a - F-492 (guardrails): tighten capsPerHour, then PUT {va:{guardrails:{capsPerHour:null}}}");
    const TIGHT = 1;
    const tighten = await rest(A.token, "PUT", { resource: "agents", id: vaId }, { va: { guardrails: { capsPerHour: TIGHT } } });
    const gTight = (await invoke("getScheduledJob", { id: vaId })).body?.job?.va?.guardrails;
    info(`PUT capsPerHour=${TIGHT} -> ${tighten.status}; guardrails now ${JSON.stringify(gTight)}`);
    if (gTight && gTight.capsPerHour === TIGHT) PASS(`the tightening landed: capsPerHour = ${TIGHT} (the baseline the null probe must not undo)`);
    else FAIL(`could not tighten capsPerHour: it reads ${gTight && gTight.capsPerHour}`);
    const putNull = await rest(A.token, "PUT", { resource: "agents", id: vaId }, { va: { guardrails: { capsPerHour: null } } });
    const gAfter = (await invoke("getScheduledJob", { id: vaId })).body?.job?.va?.guardrails;
    info(`PUT {capsPerHour:null} -> ${putNull.status}; guardrails now ${JSON.stringify(gAfter)}`);
    if (gAfter && gAfter.capsPerHour === TIGHT) PASS(`F-492 HOLDS on a LEAF: the tightened cap SURVIVED the explicit null (capsPerHour = ${TIGHT})`);
    else FAIL(`F-492 REGRESSED: the null leaf RE-WIDENED the cap: ${TIGHT} -> ${gAfter && gAfter.capsPerHour}`);
    // Every OTHER guardrail must be untouched by that PUT too.
    const gDelta = deltaOf({ ...gTight }, { ...gAfter });
    if (!gDelta.changed.length) PASS(`no other guardrail moved: ${JSON.stringify(Object.keys(gAfter || {}))}`);
    else FAIL(`the null-leaf PUT also changed ${JSON.stringify(gDelta.changed)}`);
    // RESTORE the cap to what the record was created with.
    await rest(A.token, "PUT", { resource: "agents", id: vaId }, { va: { guardrails: { capsPerHour: before.guardrails.capsPerHour } } });
    const gBack = (await invoke("getScheduledJob", { id: vaId })).body?.job?.va?.guardrails;
    if (gBack && gBack.capsPerHour === before.guardrails.capsPerHour) PASS(`RESTORED: capsPerHour is ${gBack.capsPerHour} again`);
    else FAIL(`could not restore capsPerHour: ${gBack && gBack.capsPerHour}`);

    /* ── STEP 4b — F-508: what a large `status.shadowUntilTick` is STORED as ──
     *
     * NOT A FIX AND NOT AN ASSERTION. `normalizeVa` clamps this field with
     * `int(st.shadowUntilTick, 0, Number.MAX_SAFE_INTEGER, guardrails.shadowTicks, …)`,
     * so on this build 500 has no ceiling to meet other than the integer one. F-508 is
     * NOT deployed here; this arm exists to RECORD the before-picture, exactly, so the
     * after-picture has something to be compared with. Whatever comes back is reported,
     * and the field is RESTORED to what it was.
     */
    console.log("\nSTEP 4b - F-508: PUT {va:{status:{shadowUntilTick:500}}} and record what is stored");
    const stBefore = (await invoke("getScheduledJob", { id: vaId })).body?.job?.va?.status;
    info(`status before: ${JSON.stringify(stBefore)} (guardrails.shadowTicks = ${(await invoke("getScheduledJob", { id: vaId })).body?.job?.va?.guardrails?.shadowTicks})`);
    const put508 = await rest(A.token, "PUT", { resource: "agents", id: vaId }, { va: { status: { shadowUntilTick: 500 } } });
    info(`PUT -> ${put508.status}`);
    const stAfter = (await invoke("getScheduledJob", { id: vaId })).body?.job?.va?.status;
    info(`status after: ${JSON.stringify(stAfter)}`);
    const stored = stAfter && stAfter.shadowUntilTick;
    if (stored === 500) REC(`F-508 before-picture: 500 was STORED VERBATIM (shadowUntilTick = 500). It was NOT shortened on this build - normalizeVa's ceiling for this field is Number.MAX_SAFE_INTEGER.`);
    else if (put508.status !== 200) REC(`F-508 before-picture: the PUT was REFUSED (${put508.status} ${JSON.stringify(put508.body).slice(0, 200)}); shadowUntilTick is still ${stored}`);
    else REC(`F-508 before-picture: 500 was SILENTLY SHORTENED to ${stored}`);
    if (stAfter && stBefore && stAfter.paused !== stBefore.paused) FAIL(`the shadowUntilTick PUT also changed paused: ${stBefore.paused} -> ${stAfter.paused}`);
    else PASS(`paused survived the shadowUntilTick PUT (${stAfter && stAfter.paused})`);
    // RESTORE.
    if (stored !== (stBefore && stBefore.shadowUntilTick)) {
      await rest(A.token, "PUT", { resource: "agents", id: vaId }, { va: { status: { shadowUntilTick: stBefore.shadowUntilTick } } });
      const back508 = (await invoke("getScheduledJob", { id: vaId })).body?.job?.va?.status;
      if (back508 && back508.shadowUntilTick === stBefore.shadowUntilTick) PASS(`RESTORED: shadowUntilTick is ${back508.shadowUntilTick} again`);
      else FAIL(`could not restore shadowUntilTick: ${JSON.stringify(back508)}`);
    }
  } // end of the agent arms (see the F-485 NOT-VERIFIED note above)

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
    /*
     * F-503 — THE ARM IS REACHABLE NOW, so it is ASSERTED and no longer recorded.
     *
     * The block this replaces was right about the OLD build: `ownerGate` handed
     * `gateExistingRow` the minter's ACCOUNT, `createApiToken` is `requireAdmin`, so
     * every token's owner was an app admin and `rowGateVerdict`'s `seesEverything`
     * short-circuit allowed every row. F-503 makes an editor token resolve to its OWN
     * two facts — role = min(stamp, the minter's LIVE role) and scope = "own" — so the
     * refusal is now a property of the TOKEN and not of its minter's standing.
     *
     * The minter's live role is still read and printed: it is the fact that makes this
     * a real test. If the account below still resolves to role="admin" scope="all" and
     * the foreign PUT is nevertheless 403, the refusal came from the token's effective
     * permissions and from nothing else — which is exactly the claim.
     */
    const perms = await invoke("checkIsAdmin", {});
    const ownerRole = perms.body && perms.body.role;
    const ownerScope = perms.body && perms.body.scope;
    info(`the token's owning ACCOUNT still resolves to role="${ownerRole}" scope="${ownerScope}" - so any refusal below is the TOKEN's, not the account's`);
    const other = await rest(E.token, "PUT", { resource: "listeners", id: byAdmin.row.id }, { name: "editor tried the admin's" });
    info(`editor PUT on the ADMIN token's row -> ${other.status} ${JSON.stringify(other.body).slice(0, 200)}`);
    if (other.status === 403 && other.body && other.body.hint === "not-owner") {
      PASS(`F-503 HOLDS: the editor token CANNOT edit the admin token's row -> 403 hint="not-owner" (reason="${other.body.reason}")`);
    } else if (other.status === 200) {
      FAIL(`F-503 REGRESSED: the editor token edited the ADMIN token's row -> 200. The minter is role="${ownerRole}" scope="${ownerScope}", which is precisely the short-circuit F-503 removed.`);
    } else {
      FAIL(`the editor token's PUT on the admin's row -> ${other.status} ${JSON.stringify(other.body).slice(0, 250)} - expected 403 hint="not-owner"`);
    }
    /* THE ROW IS RE-READ. A 403 that nevertheless wrote is a worse failure than a 200. */
    const foreignBack = await rest(A.token, "GET", { resource: "listeners", id: byAdmin.row.id });
    const foreignName = foreignBack.body && foreignBack.body.listener && foreignBack.body.listener.name;
    if (foreignName !== "editor tried the admin's") PASS(`SECOND READ: the admin's row is UNCHANGED after the refused PUT (name="${foreignName}")`);
    else FAIL(`the refused PUT still landed: the admin's row is now named "${foreignName}"`);

    /* THE OWNERSHIP RE-STAMP is documented behaviour in src/listeners.js ("createdBy is
     * NOT first author - it is the account whose authority the rule runs as"). It is the
     * mechanism that would turn an un-gated upsert into an ownership TRANSFER rather than
     * a mere rewrite, which is why the admin row's createdBy is read here as a BASELINE:
     * the F-490 arm below compares against this exact value. Since F-503 the foreign PUT
     * is refused, so nothing should have re-stamped anything by now. */
    const reread = await rest(A.token, "GET", { resource: "listeners", id: byAdmin.row.id });
    const nowOwner = reread.body && reread.body.listener && reread.body.listener.createdBy;
    if (nowOwner === `api:${A.id}`) PASS(`the admin row's createdBy is untouched by the refused PUT: "${nowOwner}"`);
    else FAIL(`the admin row's createdBy MOVED without a successful write: "api:${A.id}" -> "${nowOwner}"`);

    /* ── F-490 — the POST that names somebody else's id ───────────────────── */
    console.log("\nSTEP 6 - F-490: POST ?resource=listeners with a body id naming the ADMIN's row, from the EDITOR token");
    const adminBefore = await rest(A.token, "GET", { resource: "listeners", id: byAdmin.row.id });
    const nameBefore = adminBefore.body && adminBefore.body.listener && adminBefore.body.listener.name;
    const createdByBefore = adminBefore.body && adminBefore.body.listener && adminBefore.body.listener.createdBy;
    info(`the admin's row before: name="${nameBefore}" createdBy="${createdByBefore}"`);
    const upsert = await rest(E.token, "POST", { resource: "listeners" }, { ...listenerBody("HIJACKED BY THE EDITOR TOKEN"), id: byAdmin.row.id });
    info(`POST with a body id naming the admin's row -> ${upsert.status} ${JSON.stringify(upsert.body).slice(0, 250)}`);
    /*
     * F-490 — A BODY ID IS AN EDIT, AND AN EDIT ASKS THE OWNERSHIP QUESTION.
     * The refusal shape is `ownerGate`'s, imported rather than restated in src/rules-api.js,
     * so it is the SAME 403/not-owner the PUT arm above answered. A 409 would also be an
     * honest refusal here; both are accepted, a 200/201 is not.
     */
    if (upsert.status === 403 && upsert.body && upsert.body.hint === "not-owner") {
      PASS(`F-490 CLOSED: the POST upsert is refused by the SAME gate as the PUT -> 403 hint="not-owner"`);
    } else if (upsert.status === 409) {
      PASS(`F-490 CLOSED: the POST upsert is refused -> 409 ${JSON.stringify(upsert.body).slice(0, 160)}`);
    } else if (upsert.status === 200 || upsert.status === 201) {
      FAIL(`F-490 REGRESSED: the editor token's POST REWROTE the admin's row -> ${upsert.status}`);
    } else {
      FAIL(`the POST upsert -> ${upsert.status} ${JSON.stringify(upsert.body).slice(0, 250)} - expected a 403 not-owner or a 409`);
    }
    /* THE SECOND READ, which is the only thing that can tell a refusal from a silent write. */
    const adminAfter = await rest(A.token, "GET", { resource: "listeners", id: byAdmin.row.id });
    const rowAfter = adminAfter.body && adminAfter.body.listener;
    info(`the admin's row after: name="${rowAfter && rowAfter.name}" createdBy="${rowAfter && rowAfter.createdBy}"`);
    if (rowAfter && rowAfter.name === nameBefore) PASS(`SECOND READ: the admin's row is UNCHANGED - name is still "${nameBefore}"`);
    else FAIL(`the admin's row CHANGED: "${nameBefore}" -> "${rowAfter && rowAfter.name}"`);
    if (rowAfter && rowAfter.createdBy === createdByBefore) PASS(`SECOND READ: ownership was NOT transferred - createdBy is still "${createdByBefore}"`);
    else FAIL(`ownership TRANSFERRED: createdBy "${createdByBefore}" -> "${rowAfter && rowAfter.createdBy}"`);

    /*
     * F-493 — THE CREATE ROUTE RE-READS THE OWNING ACCOUNT'S LIVE ROLE.
     * A plain create (no body id) on the editor token must still SUCCEED while the minter
     * is an editor-or-better, and that success is the positive control which makes the two
     * refusals above answers about OWNERSHIP rather than a create route that is simply dead.
     */
    const plainName = `doors editor plain create ${Date.now()}`;
    const plain = await mkListener(E.token, plainName);
    if (plain.status === 201 && plain.row && plain.row.id) PASS(`F-493 positive control: the SAME editor token CAN still create its own row -> 201 (id=${plain.row.id}, createdBy="${plain.row.createdBy}") - so the refusals above are about the ROW's owner, not a dead route`);
    else FAIL(`the editor token's plain create -> ${plain.status} ${JSON.stringify(plain.body).slice(0, 250)}`);
  }

  /* ── STEP 7 — F-480: renaming a listener that HOLDS a capability-gated action ──
   *
   * `normalizeListener` runs `assertAllowedActions` against the instance's gate context,
   * so before F-480 a REST rename of a rule holding `get_pull_request` was a permanent
   * 400: the row was armed by an admin's click on a capable instance and then became
   * un-editable over REST forever. The fix gives this door the SAME fact reader the
   * resolvers use (`agentGateFacts`), so the answer now tracks the instance.
   *
   * THE TWO ANSWERS THIS ARM CAN HONESTLY GIVE, and it reports which one it got:
   *  - capability ON  → the create succeeds AND the rename returns 200 (F-480's claim).
   *  - capability OFF → the row cannot be CREATED here at all, so there is nothing to
   *    rename. That is reported NOT VERIFIED with the create's own refusal attached; it
   *    is not dressed up as a proof of the refusal, because a 400 on a row that does not
   *    exist is not the 400 F-480 is about.
   */
  console.log("\nSTEP 7 - F-480: a listener holding `get_pull_request`, renamed over REST");
  const gitListener = {
    name: `doors git-action ${Date.now()}`, enabled: false, events: ["avi:jira:commented:issue"],
    filters: { projectKeys: [PROJECT] }, mode: "agent",
    agent: { instructions: "Read the pull request named in the comment and summarise it.", allowedActions: ["get_pull_request"] },
  };
  const gitCreate = await rest(A.token, "POST", { resource: "listeners" }, gitListener);
  info(`POST a listener holding get_pull_request -> ${gitCreate.status} ${JSON.stringify(gitCreate.body).slice(0, 260)}`);
  const gitRow = gitCreate.body && gitCreate.body.listener;
  if (gitRow && gitRow.id) {
    cleanup.listenerIds.push(gitRow.id);
    const held = (gitRow.agent && gitRow.agent.allowedActions) || [];
    if (held.includes("get_pull_request")) PASS(`the row really HOLDS the capability-gated action: allowedActions=${JSON.stringify(held)}`);
    else FAIL(`the row was created but DROPPED the action: allowedActions=${JSON.stringify(held)} - a rename of it would not test F-480`);
    const rename = await rest(A.token, "PUT", { resource: "listeners", id: gitRow.id }, { name: `${gitListener.name} RENAMED` });
    info(`PUT rename -> ${rename.status} ${JSON.stringify(rename.body).slice(0, 240)}`);
    if (rename.status === 200) PASS(`F-480 HOLDS: the rename of a row holding get_pull_request returned 200 on a CAPABLE instance`);
    else FAIL(`the rename -> ${rename.status} (F-480's permanent-400 is back): ${JSON.stringify(rename.body).slice(0, 300)}`);
    // SECOND READ: the new name landed AND the action survived the rename.
    const gitBack = await rest(A.token, "GET", { resource: "listeners", id: gitRow.id });
    const backRow = gitBack.body && gitBack.body.listener;
    if (backRow && backRow.name === `${gitListener.name} RENAMED`) PASS(`SECOND READ: the rename landed (name="${backRow.name}")`);
    else FAIL(`SECOND READ: the name is "${backRow && backRow.name}"`);
    const backActions = (backRow && backRow.agent && backRow.agent.allowedActions) || [];
    if (backActions.includes("get_pull_request")) PASS(`SECOND READ: the rename did NOT strip the action (allowedActions=${JSON.stringify(backActions)})`);
    else FAIL(`the rename STRIPPED the capability-gated action: allowedActions=${JSON.stringify(backActions)}`);
  } else {
    const b = gitCreate.body || {};
    NV(`F-480's rename is NOT EXERCISABLE on ${ENV_NAME}: the row cannot be CREATED here (${gitCreate.status} reason="${b.reason}" refused=${JSON.stringify(b.refused)} error="${String(b.error || "").slice(0, 180)}"). A capability-gated action can only be armed on an instance where the capability is ON, so there is nothing here to rename - and a 400 on a non-existent row is not the 400 F-480 is about.`);
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
    console.log("\nCLEANUP");
    const residue = [];
    /* THE MODEL SLOT FIRST, and unconditionally - it is instance-wide config that every
     * other surface reads, and --keep is about the ROWS this run made, never about the
     * tenant's settings. A restore that silently no-ops leaves the next run lying. */
    if (agentModelSlotBefore !== undefined) {
      const r = await hook({ action: "kvSet", key: AGENT_MODEL_SLOT, value: agentModelSlotBefore });
      console.log(`        kvSet ${AGENT_MODEL_SLOT} -> ${JSON.stringify(r.body).slice(0, 160)}`);
      const back = await kvs(AGENT_MODEL_SLOT).catch(() => null);
      const ok = !!(back && back.ok && JSON.stringify(back.value) === JSON.stringify(agentModelSlotBefore));
      console.log(`        ${ok ? "RESTORED" : "NOT RESTORED"}: the slot reads back ${JSON.stringify(back && back.value)} (was ${JSON.stringify(agentModelSlotBefore)})`);
      const capBack = await invoke("getAgentCapability", {}).catch(() => null);
      console.log(`        getAgentCapability after the restore: ${JSON.stringify(capBack && capBack.body)}`);
      if (!ok) residue.push(`${AGENT_MODEL_SLOT} still holds ${JSON.stringify(back && back.value)} instead of the pre-run ${JSON.stringify(agentModelSlotBefore)}`);
    }
    if (KEEP) { console.log("        ROW CLEANUP SKIPPED (--keep)"); if (residue.length) { console.error(`\nCLEANUP FAILED:\n        ${residue.join("\n        ")}`); process.exitCode = 1; } return; }
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
