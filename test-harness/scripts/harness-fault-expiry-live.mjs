/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-664 / F-667 / F-661 LIVE — THE FAULT WINDOW REALLY ENDS, AND THE SWEEP REACHES
 * THE ROW NOBODY WILL LOOK AT AGAIN.
 *
 * F-664 was "a harness fault row never expires": armed with ttlSeconds:5 it still bit at
 * 615 s, because Forge KVS deletes expired keys LAZILY and a platform TTL is therefore
 * never a read bound. F-667 is the half of that fix which the fix itself could not reach:
 * a row written before the deploy carries no `until`, so a read-time bound has nothing to
 * judge it by, and nothing enumerates the keyspace. This driver is the live proof of both
 * halves against a deployed build, on whichever environment it is pointed at:
 *
 *   1. ARM the Jira user-search lever for 5 s. Read it AT ONCE: the row carries `until`,
 *      `expired` is false, and the stamp is ~5 s ahead of `armedAt` (the TTL is the row's
 *      own, not the family ceiling).
 *   2. POSITIVE CONTROL for the sweep's query: a dry-run sweep LISTS that armed row while
 *      it is alive, and does not delete it. An empty sweep result proves nothing until the
 *      query has been shown to see a row at all.
 *   3. WAIT past the window. `readJiraFault` answers `expired:true` (or the row is gone),
 *      and `searchUsers` through the hook — as the admin, the same call that returned the
 *      429 refusal while the lever was live — returns REAL USERS. The lever no longer bites
 *      past its window, which is the user-visible statement F-664 is about.
 *   4. The SAME round trip on `armKeyReadFault`, because the expiry lives in the shared
 *      `getFaultRow` and a fix proven on one member of the family is a fix assumed on the
 *      other four.
 *   5. THE SWEEP, against a row NO READ HAS TOUCHED (the crashed-driver row F-667 is about
 *      — every read above deletes its own expired row on the way out). A dry run lists every
 *      `harness_fault:*` row with `until`, the `deadline`
 *      that BOUNDS it and `expired`; a real sweep deletes the expired ones; a second dry
 *      run shows none expired. Any row listed with `until:null` is an F-667 RESIDUAL — a
 *      pre-deploy legacy row — and is reported as such by count.
 *   6. F-661 ROUTE SEAM. `searchUsers` with a query containing a SPACE and one containing
 *      a `/` must come back 200 with a well-formed answer: the `route` tag escapes the
 *      caller's text into query position, so neither reaches Jira as path manipulation nor
 *      as a split parameter. A 4xx here is the seam leaking — and 200 alone is not the
 *      proof: each count is compared against JIRA'S OWN answer to the same query fetched
 *      directly over REST, with `zzzznope` as the control that the endpoint discriminates.
 *
 * WHAT IT DOES NOT PROVE, and says so rather than implying otherwise: the SECOND consumer
 * of the endpoint, `resolveUserToAccountId`, is on the semantic-PF assignee WRITE path and
 * is reachable through no hook action (`testSemanticPostFunction` is not on the
 * `invokeResolver` allow-list). It is reported N/V with that reason.
 *
 * READ-ONLY on src/ and static/. It never deploys, takes no screenshot and grants no role.
 * Every sentence and every payload — console and disk alike — goes through `redactSecrets`
 * /`redactString`, so no token, secret or dev web-trigger URL can reach the terminal or the
 * evidence file, and emails land masked.
 *
 * CLEANUP IS PART OF THE PROOF: both levers are disarmed in a `finally` and the last two
 * reads must answer `value:null`.
 *
 *   node scripts/harness-fault-expiry-live.mjs [--env=dev|staging] [--query=mihai]
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { redactString, redactSecrets } from "../lib/redact.mjs";

const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const ENV_NAME = arg("env", "dev");
const HOOK_URL = ENV_NAME === "dev" ? env.TESTSTATE_URL : env.STAGING_TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const QUERY = arg("query", "mihai");
const PATH = "/rest/api/3/user/search";
const FAULT_STATUS = 429;
const TTL = 5;          // the row's own window
const WAIT_MS = 8000;   // comfortably past it, and well under the 300 s cap
const PROVIDER = "openai";

if (!HOOK_URL) { console.error(`no web-trigger URL for environment "${ENV_NAME}"`); process.exit(2); }

const OUT = new URL("../results/harness-fault-expiry", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: ENV_NAME, path: PATH, ttlSeconds: TTL, checks: [] };
const R = (d) => redactSecrets(d);
const J = (d) => JSON.stringify(R(d));
const say = (v, s, d) => { ev.checks.push({ v, s: redactString(String(s)), ...(d ? { d: R(d) } : {}) }); console.log(`  ${v.padEnd(5)} ${redactString(String(s))}${d ? " " + J(d) : ""}`); };
const PASS = (s, d) => { passes++; say("PASS", s, d); };
const FAIL = (s, d) => { fails++; say("FAIL", s, d); };
const NV = (s, d) => { unproven++; say("N/V", s, d); };
const step = (s) => console.log(`\n── ${s}`);

const readRes = async (res) => { let t = ""; try { t = await res.text(); } catch { return { status: 0, json: null }; } let j = null; try { j = JSON.parse(t); } catch {} return { status: res.status, json: j, text: t }; };
const hook = async (body) => readRes(await fetch(HOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET }, body: JSON.stringify(body) }));
const invoke = (functionKey, payload = {}, accountId = ADMIN) => hook({ action: "invokeResolver", functionKey, payload, accountId });

/* Jira's OWN answer to the same query, for the F-661 comparison. Basic auth from .env; the
 * header is built inline and never logged, and only the COUNT leaves this function. */
const jiraUserSearchCount = async (q) => {
  const base = env.JIRA_BASE_URL, email = env.JIRA_ADMIN_EMAIL, token = env.JIRA_API_TOKEN;
  if (!base || !email || !token) return { status: 0, count: null };
  try {
    const res = await fetch(`${base}${PATH}?query=${encodeURIComponent(q)}&maxResults=10`, {
      headers: { Authorization: "Basic " + Buffer.from(`${email}:${token}`).toString("base64"), Accept: "application/json" },
    });
    const j = await res.json().catch(() => null);
    return { status: res.status, count: Array.isArray(j) ? j.length : null };
  } catch { return { status: 0, count: null }; }
};

const armJira = (ttlSeconds) => hook({ action: "armJiraFault", path: PATH, status: FAULT_STATUS, ttlSeconds });
const readJira = () => hook({ action: "readJiraFault", path: PATH });
const disarmJira = () => hook({ action: "disarmJiraFault", path: PATH });
const armKey = (ttlSeconds) => hook({ action: "armKeyReadFault", provider: PROVIDER, mode: "refuse", ttlSeconds });
const readKey = () => hook({ action: "readKeyReadFault", provider: PROVIDER });
const disarmKey = () => hook({ action: "disarmKeyReadFault", provider: PROVIDER });
const sweep = (dryRun) => hook({ action: "sweepHarnessFaults", dryRun });

/** A row summary that carries no key TAIL (the path/provider) and no value beyond the dates. */
const rowShape = (r) => ({ until: r.json?.until ?? null, expired: r.json?.expired ?? null, hasValue: Boolean(r.json?.value) });
/** Sweep rows, counted — never the keys themselves, which carry the faulted path. */
const sweepShape = (j) => ({
  scanned: j?.scanned ?? null, deleted: j?.deleted ?? null, failed: j?.failed ?? null,
  truncated: j?.truncated ?? null,
  expiredRows: (j?.rows || []).filter((r) => r.expired).length,
  liveRows: (j?.rows || []).filter((r) => !r.expired).length,
  legacyNoUntil: (j?.rows || []).filter((r) => r.until === null).length,
});

async function main() {
  console.log(`\nHARNESS FAULT EXPIRY — env=${ENV_NAME}  ttl=${TTL}s  wait=${WAIT_MS / 1000}s`);

  step("0 · BASELINE — what is in the fault keyspace before this driver arms anything");
  const base = await sweep(true);
  if (base.status !== 200 || base.json?.ok !== true) FAIL("baseline dry-run sweep did not answer 200/ok", { status: base.status });
  else {
    const s = sweepShape(base.json);
    ev.baseline = s;
    PASS("baseline dry-run sweep answered", s);
    if (s.legacyNoUntil > 0) FAIL(`F-667 RESIDUAL: ${s.legacyNoUntil} legacy row(s) with no 'until' present before the sweep`, s);
    else PASS("no legacy (no-'until') row present before the sweep", { legacyNoUntil: 0 });
  }

  step("1 · ARM the Jira user-search lever for 5 s, and read it AT ONCE");
  const armed = await armJira(TTL);
  if (armed.status !== 200 || armed.json?.ok !== true) FAIL("armJiraFault did not answer 200/ok", { status: armed.status });
  else PASS("armJiraFault accepted", { ttlSeconds: armed.json.ttlSeconds ?? TTL, maxTtlSeconds: armed.json.maxTtlSeconds });
  const armedAtMs = Date.now();

  const r0 = await readJira();
  const s0 = rowShape(r0);
  if (!s0.hasValue) FAIL("readJiraFault has no row immediately after arming", s0);
  else if (!s0.until) FAIL("F-664: the armed row carries NO 'until' stamp", s0);
  else if (s0.expired !== false) FAIL("the freshly armed row already reads as expired", s0);
  else {
    const ahead = Math.round((Date.parse(s0.until) - armedAtMs) / 1000);
    if (ahead > TTL + 3) FAIL(`the row's window is ${ahead}s, not the ~${TTL}s asked for (the family ceiling was stamped instead)`, { ahead });
    else PASS(`row carries 'until' ~${ahead}s ahead and expired:false`, s0);
  }

  step("2 · POSITIVE CONTROL — a dry-run sweep can SEE a live row, and leaves it alone");
  const live = await sweep(true);
  const sl = sweepShape(live.json);
  if (sl.liveRows < 1) FAIL("the dry-run sweep listed NO live row while a lever is armed — the query cannot see the keyspace", sl);
  else PASS("dry-run sweep lists the live armed row", sl);
  if ((live.json?.deleted ?? 0) !== 0) FAIL("a DRY RUN deleted rows", sl);
  else PASS("dry run deleted nothing", { deleted: 0 });

  step(`3 · WAIT ${WAIT_MS / 1000}s — past the window — then read the row and search for real`);
  await sleep(WAIT_MS);
  const r1 = await readJira();
  const s1 = rowShape(r1);
  if (!s1.hasValue) PASS("the row is gone after its window", s1);
  else if (s1.expired === true) PASS("the row reads expired:true after its window", s1);
  else FAIL("F-664 REGRESSION: the row is still live past its TTL", s1);

  const su = await invoke("searchUsers", { query: QUERY });
  if (su.status !== 200) FAIL("searchUsers through the hook did not answer 200", { status: su.status });
  else {
    const res = su.json?.result ?? su.json;
    if (res?.success === true && Array.isArray(res.users) && res.users.length > 0) PASS(`the lever no longer bites: searchUsers returned ${res.users.length} real user(s)`, { success: true, users: res.users.length });
    else if (res?.reason === "jira_unavailable") FAIL("F-664 REGRESSION: searchUsers still refuses with jira_unavailable past the TTL", { reason: res.reason, status: res.status });
    else FAIL("searchUsers answered neither real users nor the fault refusal", { shape: Object.keys(res || {}) });
  }

  step("4 · THE SAME ROUND TRIP on armKeyReadFault (the expiry is shared, not per-lever)");
  const ka = await armKey(TTL);
  if (ka.status !== 200 || ka.json?.ok !== true) FAIL("armKeyReadFault did not answer 200/ok", { status: ka.status });
  else PASS("armKeyReadFault accepted", { maxTtlSeconds: ka.json.maxTtlSeconds });
  const k0 = rowShape(await readKey());
  if (k0.hasValue && k0.until && k0.expired === false) PASS("key-read row carries 'until' and expired:false at once", k0);
  else FAIL("key-read row is missing its stamp or already expired", k0);
  await sleep(WAIT_MS);
  const k1 = rowShape(await readKey());
  if (!k1.hasValue) PASS("key-read row is gone after its window", k1);
  else if (k1.expired === true) PASS("key-read row reads expired:true after its window", k1);
  else FAIL("F-664 REGRESSION on the key-read lever: still live past its TTL", k1);

  step("5 · THE SWEEP — an EXPIRED ROW NOBODY READ is what the sweep exists for");
  /* The reads above already cleared their own rows: `getFaultRow` deletes an expired row on
   * the way out, which is F-664's read-time bound doing its job. That is exactly why the
   * sweep needs a row that NO read has touched — the crashed-driver row of F-667. So: arm,
   * never read, wait past the window, and let the sweep be the first thing to see it. */
  const a2 = await armJira(TTL);
  if (a2.status !== 200 || a2.json?.ok !== true) FAIL("could not arm the unread row for the sweep", { status: a2.status });
  await sleep(WAIT_MS);
  const d1 = await sweep(true);
  const sd1 = sweepShape(d1.json);
  ev.sweepBefore = sd1;
  if (sd1.expiredRows < 1) FAIL("the dry run listed no expired row for a lever armed 8s ago with a 5s window", sd1);
  else PASS(`dry run lists ${sd1.expiredRows} expired row(s), and deleted nothing`, sd1);
  if (sd1.legacyNoUntil > 0) FAIL(`F-667 RESIDUAL: ${sd1.legacyNoUntil} row(s) with no 'until'`, sd1);
  else PASS("no row in the keyspace lacks an 'until' stamp", { legacyNoUntil: 0 });

  const real = await sweep(false);
  const sr = sweepShape(real.json);
  ev.sweepReal = sr;
  if (real.status !== 200 || real.json?.ok !== true) FAIL("the real sweep did not answer 200/ok", { status: real.status });
  else if (sr.deleted >= sd1.expiredRows && sr.failed === 0) PASS(`the real sweep deleted ${sr.deleted} expired row(s), 0 failures`, sr);
  else FAIL("the real sweep did not delete every expired row it listed", { listed: sd1.expiredRows, ...sr });

  const d2 = await sweep(true);
  const sd2 = sweepShape(d2.json);
  ev.sweepAfter = sd2;
  if (sd2.expiredRows === 0) PASS("second dry run: no expired row remains", sd2);
  else FAIL("expired rows survived the sweep", sd2);

  step("6 · F-661 ROUTE SEAM — a SPACE and a SLASH reach Jira escaped, and INTACT");
  /* 200 alone would only prove Jira did not reject the request. The second read is Jira's
   * OWN answer to the same query, fetched directly over REST with `encodeURIComponent`: if
   * the app's tag dropped, split or mangled the parameter, the two counts would diverge.
   * `zzzznope` is the control that the endpoint discriminates at all, so an equal count is
   * evidence rather than a coincidence of a search that matches everything. */
  for (const q of ["Mihai Perdum", "a/b", "zzzznope"]) {
    const r = await invoke("searchUsers", { query: q });
    const res = r.json?.result ?? r.json;
    const direct = await jiraUserSearchCount(q);
    if (r.status !== 200) FAIL(`searchUsers(${JSON.stringify(q)}) did not answer 200 through the hook`, { status: r.status });
    else if (res?.reason === "jira_unavailable") FAIL(`searchUsers(${JSON.stringify(q)}) -> jira_unavailable HTTP ${res.status}: the tag did not escape the character`, { status: res.status });
    else if (!(res?.success === true && Array.isArray(res.users))) FAIL(`searchUsers(${JSON.stringify(q)}) answered an unexpected shape`, { shape: Object.keys(res || {}) });
    else if (direct.status !== 200) NV(`could not fetch Jira's own answer for ${JSON.stringify(q)} to compare`, { status: direct.status });
    else if (direct.count === res.users.length) PASS(`searchUsers(${JSON.stringify(q)}) -> ${res.users.length} user(s), identical to Jira's own answer`, { app: res.users.length, jira: direct.count });
    else FAIL(`searchUsers(${JSON.stringify(q)}) returned ${res.users.length} where Jira itself returns ${direct.count} — the parameter did not arrive intact`, { app: res.users.length, jira: direct.count });
  }

  NV("resolveUserToAccountId (the second consumer, on the semantic-PF assignee WRITE path) is reachable through no hook action — testSemanticPostFunction is not on the invokeResolver allow-list, and the path needs an AI run against a user field. Not exercised here.");
}

try {
  await main();
} catch (e) {
  FAIL("driver threw", { error: redactString(String((e && e.message) || e)) });
} finally {
  step("CLEANUP — disarm both levers and prove the rows are gone");
  await disarmJira().catch(() => {});
  await disarmKey().catch(() => {});
  const c1 = rowShape(await readJira());
  const c2 = rowShape(await readKey());
  if (!c1.hasValue) PASS("second read: no Jira fault row left armed", c1); else FAIL("a Jira fault row is STILL armed after cleanup", c1);
  if (!c2.hasValue) PASS("second read: no key-read fault row left armed", c2); else FAIL("a key-read fault row is STILL armed after cleanup", c2);
  const fin = sweepShape((await sweep(true)).json);
  ev.finalSweep = fin;
  say(fin.liveRows === 0 && fin.expiredRows === 0 ? "PASS" : "FAIL", "final dry-run sweep of the fault keyspace", fin);
  if (fin.liveRows === 0 && fin.expiredRows === 0) passes++; else fails++;

  ev.summary = { passes, fails, unproven };
  const file = `${OUT}/${ENV_NAME}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(file, JSON.stringify(redactSecrets(ev), null, 2));
  console.log(`\nPASS ${passes}  FAIL ${fails}  N/V ${unproven}`);
  console.log(`evidence: ${file}`);
  process.exit(fails > 0 ? 1 : 0);
}
