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
 *      EVERY sweep in this driver is DRAINED (F-675): the sweep is bounded by a time budget
 *      and a 200-row list cap, so a single call answers for a PAGE, never for the keyspace.
 *      `drainSweep` loops on the returned `cursor` until a call answers `truncated:false`
 *      (bounded at 20 calls), and `sweepUsable` FAILS — naming which — on a sweep that
 *      stopped, a sweep with no resumable cursor, or a capped row list under an assertion
 *      derived from rows. A partial sweep can no longer be recorded as a clean one.
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
 * ⚠️ BLAST RADIUS — THIS DRIVER ARMS REAL FAULTS ON A SHARED TENANT (F-679).
 * The READ-ONLY guarantee below is about the REPOSITORY. It says nothing about the tenant,
 * and this driver is not passive there: it deliberately makes the live app misbehave. Two
 * levers, both user-visible to anyone else on the site while they are armed:
 *
 *   · `armKeyReadFault("openai", "refuse")` — for ~5 s per arming, every read of the openai
 *     key slot refuses. An admin sitting on Settings → Providers sees "Couldn't read key
 *     status", and a "test key" click answers a planted refusal. The realistic harm is not
 *     the 5 s: it is that they read it as a bad credential and ROTATE A WORKING KEY.
 *   · `armJiraFault("/rest/api/3/user/search", 429)` — for ~5 s per arming, user search
 *     answers 429. The Permissions tab's people picker shows a throttling notice and finds
 *     nobody; a rule author mid-edit sees an empty search.
 *
 * Each window is the row's own 5 s TTL, and the CLEANUP `finally` disarms both on every
 * path including the throw. It does NOT cover the process being KILLED — the 300 s family
 * ceiling is the only bound then, which is the scenario F-664/F-667 exist because of. So:
 *
 *   ENVIRONMENT DEFAULT IS `staging`. Pointing this at the shared dev tenant is a
 *   deliberate act and requires `--i-know-dev-is-shared` alongside `--env=dev`, because
 *   nothing in the evidence file or the terminal would ever tell the admin who just
 *   rotated a good key that a harness lever was live at that moment. Schedule the run,
 *   or tell whoever is on the tenant — do not discover it afterwards.
 *
 * READ-ONLY on src/ and static/. It never deploys, takes no screenshot and grants no role.
 * Every sentence and every payload — console and disk alike — goes through `redactSecrets`
 * /`redactString`, so no token, secret or dev web-trigger URL can reach the terminal or the
 * evidence file, and emails land masked.
 *
 * CLEANUP IS PART OF THE PROOF: both levers are disarmed in a `finally` and the last two
 * reads must answer `value:null`.
 *
 *   node scripts/harness-fault-expiry-live.mjs [--env=staging|dev] [--query=mihai]
 *   node scripts/harness-fault-expiry-live.mjs --env=dev --i-know-dev-is-shared
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { redactString, redactSecrets } from "../lib/redact.mjs";
import { drainSweep as runDrain } from "../lib/sweep-drain.mjs";

const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
/* The provider slot this driver faults. Declared up here because the F-679 refusal names
 * it, and that refusal runs before anything else. */
const PROVIDER = "openai";
/* F-679, moved to its one home by F-686 — STAGING BY DEFAULT, and `--env=dev` is a
 * deliberate act. The refusal text, the harm sentences and the TTL→env→hook-URL mapping
 * all live in lib/shared-env-guard.mjs now, because this file was the ONLY one of the four
 * fault drivers that carried them. The environment is still settled BEFORE anything is
 * loaded or read (requireEnvAck refuses before it touches .env), so the guard is not a
 * courtesy for the configured and a surprise for everyone else. */
const { envName: ENV_NAME, hookUrl: HOOK_URL } = requireEnvAck(process.argv.slice(2), {
  faults: [`keyRead:${PROVIDER}`, "jiraUserSearch"],
  maxSeconds: 5,   // every arming in this driver is the 5s TTL the expiry proof needs
  script: "harness-fault-expiry-live.mjs",
});
/* Settled — only now may the env file speak (requireEnvAck has already loaded it). */
const env = loadEnv();
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const QUERY = arg("query", "mihai");
const PATH = "/rest/api/3/user/search";
const FAULT_STATUS = 429;
const TTL = 5;          // the row's own window
const WAIT_MS = 8000;   // comfortably past it, and well under the 300 s cap
/* PROVIDER is declared above, with the F-679 refusal that names it. */

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
const sweep = (dryRun, cursor) => hook({ action: "sweepHarnessFaults", dryRun, ...(typeof cursor === "string" && cursor ? { cursor } : {}) });

/** A row summary that carries no key TAIL (the path/provider) and no value beyond the dates. */
const rowShape = (r) => ({ until: r.json?.until ?? null, expired: r.json?.expired ?? null, hasValue: Boolean(r.json?.value) });
/*
 * Sweep rows, counted — never the keys themselves, which carry the faulted path.
 *
 * F-675 — THE THREE FIELDS THE ANSWER CARRIES AND THIS DRIVER USED TO THROW AWAY.
 * `sweepHarnessFaults` answers with TWO independent truncation flags and a resume token, and
 * each of them can turn a green assertion into a lie:
 *   · `truncated` + `reason` — the sweep STOPPED (budget or page cap). Its counters describe
 *     only the part it reached; `cursor` is the token to POST back to continue.
 *   · `rowsTruncated`        — the COUNTERS are whole but the `rows` LIST was capped at
 *     `HARNESS_FAULT_SWEEP_MAX_ROWS` (200). Anything counted OUT of that list — `expiredRows`,
 *     `liveRows`, `legacyNoUntil`, all three derived right here — is then a count of the first
 *     200 rows and not of the keyspace.
 * The driver copied `truncated` into the evidence and asserted on none of them, so a sweep
 * that listed 200 of 600 expired rows and gave up on its budget recorded as a clean keyspace.
 * `hasCursor` rather than the cursor itself: a KVS cursor is an opaque token that may encode a
 * key, and the keys here carry the faulted path — the same reason this shape never returns
 * `rows`.
 */
const sweepShape = (j) => ({
  scanned: j?.scanned ?? null, deleted: j?.deleted ?? null, failed: j?.failed ?? null,
  truncated: j?.truncated ?? null, reason: j?.reason ?? null,
  /* F-690/F-692 — `complete` is the LIBRARY'S single source for "the whole keyspace was
     walked and every delete landed". It is carried here so the evidence records the answer
     the loop actually obeyed, rather than a `truncated` the driver re-derived a verdict from. */
  complete: typeof j?.complete === "boolean" ? j.complete : null,
  rowsTruncated: j?.rowsTruncated ?? null, hasCursor: Boolean(j?.cursor),
  expiredRows: (j?.rows || []).filter((r) => r.expired).length,
  liveRows: (j?.rows || []).filter((r) => !r.expired).length,
  legacyNoUntil: (j?.rows || []).filter((r) => r.until === null).length,
});

/** The bound on the resume loop. A sweep that cannot finish inside 20 budgets is a finding, not a retry. */
const MAX_SWEEP_CALLS = 20;

/*
 * DRAIN a sweep to completion instead of judging its first page.
 *
 * Accumulates the COUNTERS across calls and stops on exactly one terminal condition, each of
 * which a verdict can name:
 *   drained:true                  — a call answered `complete:true`. The accumulated counters
 *                                   describe the WHOLE keyspace and may be asserted on.
 *   stopReason "no ... cursor"    — incomplete with no resumable token. The work is abandoned
 *                                   and nothing about the rest of the keyspace is known.
 *   stopReason "not-converging"   — the store is refusing deletes, or the answer is repeating
 *                                   itself byte for byte. See `lib/sweep-drain.mjs`.
 *   stopReason "deletes-failed …" — the keyspace was walked but deletes did not land, and the
 *                                   one resume from that page did not clear them.
 *   stopReason "bound"            — still incomplete after MAX_SWEEP_CALLS.
 *   stopReason "HTTP"             — a call did not answer 200/ok.
 *
 * F-690 — THE LOOP OBEYS THE CONTRACT INSTEAD OF ONLY `truncated`. This loop used to break
 * solely on `truncated !== true`, which made `deletes-failing` — truncated, with THIS page's
 * own cursor — indistinguishable from a healthy budget resume: the identical token went
 * straight back, unpaced, twenty times, sixty rejected deletes at a store already refusing,
 * and it stopped on the driver's private bound rather than on anything the contract said.
 * The decision now lives in `lib/sweep-drain.mjs` as a pure function with an offline unit
 * around all three reasons, because the previous home of that contract was a hand-written
 * loop inside `harness-fault-ttl.test.mjs` — one rule, two homes, and the production one
 * never implemented it. This function is now only the I/O: call, decide, sleep, resume.
 *
 * F-692 prep — FINISHEDNESS IS READ, NOT RE-DERIVED. `drained` comes from the answer's own
 * `complete`, so tightening that field in `src/harness-fault.js` cannot leave this driver
 * asserting over a page the library considers unfinished.
 *
 * A resumed sweep may RE-LIST rows it already cleaned (its cursor re-fetches the page it was
 * working on, by design), so these totals can OVER-count. That direction is safe for every
 * assertion built on them here: each is "this count must be zero" or "this count must be at
 * least one", and over-counting can never turn a dirty keyspace into a clean verdict.
 */
const drainSweep = async (dryRun) => {
  const totals = { scanned: 0, deleted: 0, failed: 0, expiredRows: 0, liveRows: 0, legacyNoUntil: 0 };
  let lastShape = null, rowsTruncatedAny = false;
  /* F-702 — THE LOOP IS THE LIBRARY'S TOO, not just the decision. This function is now only
     the driver's ACCOUNTING: the per-answer shape, the totals and the row-cap flag. Calling,
     deciding, pausing and resuming live in `lib/sweep-drain.mjs`, which is also what
     `plant-sweep-live.mjs` obeys, so the two drivers cannot answer a refusing store
     differently. */
  const d = await runDrain((cursor) => sweep(dryRun, cursor), {
    maxCalls: MAX_SWEEP_CALLS,
    onAnswer: (json) => {
      const shape = sweepShape(json);
      lastShape = shape;
      for (const k of Object.keys(totals)) totals[k] += Number(shape[k] || 0);
      if (shape.rowsTruncated === true) rowsTruncatedAny = true;
    },
  });
  return {
    drained: d.drained, stopReason: d.stopReason, calls: d.calls,
    rowsTruncatedAny, pausedMs: d.pausedMs, ...totals, last: lastShape,
  };
};

/*
 * The gate every sweep assertion now sits behind. Returns false — after FAILing with the
 * reason — whenever the drain did not reach an untruncated answer, so nothing downstream can
 * assert over a partial count. `listMustBeWhole` additionally refuses a CAPPED ROW LIST, and
 * is required wherever the assertion is derived from `rows` (expiredRows / liveRows /
 * legacyNoUntil) rather than from the whole-keyspace counters `scanned` / `deleted`.
 */
const sweepUsable = (label, d, listMustBeWhole = true) => {
  if (!d.drained) { FAIL(`${label}: ${d.stopReason}`, { calls: d.calls, ...(d.last || {}) }); return false; }
  if (listMustBeWhole && d.rowsTruncatedAny) {
    FAIL(`${label}: the sweep's row list was capped (rowsTruncated:true) — every per-row count here would be a count of the first 200 rows, not of the keyspace`, { calls: d.calls, scanned: d.scanned });
    return false;
  }
  return true;
};

/** What a drained sweep leaves in the evidence file: the totals, not one call's page. */
const drainShape = (d) => ({
  drained: d.drained, calls: d.calls, rowsTruncated: d.rowsTruncatedAny,
  /* F-690 — how long the drain SLEPT between resumes. Zero on a healthy run; non-zero is the
     back-off having been taken, which is the one visible trace that the store was refusing. */
  pausedMs: d.pausedMs ?? 0,
  scanned: d.scanned, deleted: d.deleted, failed: d.failed,
  expiredRows: d.expiredRows, liveRows: d.liveRows, legacyNoUntil: d.legacyNoUntil,
  ...(d.stopReason ? { stopReason: d.stopReason } : {}),
});

async function main() {
  console.log(`\nHARNESS FAULT EXPIRY — env=${ENV_NAME}  ttl=${TTL}s  wait=${WAIT_MS / 1000}s`);

  step("0 · BASELINE — what is in the fault keyspace before this driver arms anything");
  const base = await drainSweep(true);
  ev.baseline = drainShape(base);
  if (sweepUsable("baseline dry-run sweep", base)) {
    PASS(`baseline dry-run sweep drained in ${base.calls} call(s), ${base.scanned} row(s) scanned`, drainShape(base));
    if (base.legacyNoUntil > 0) FAIL(`F-667 RESIDUAL: ${base.legacyNoUntil} legacy row(s) with no 'until' present before the sweep`, drainShape(base));
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
  const live = await drainSweep(true);
  ev.positiveControl = drainShape(live);
  if (sweepUsable("positive-control dry-run sweep", live)) {
    if (live.liveRows < 1) FAIL("the dry-run sweep listed NO live row while a lever is armed — the query cannot see the keyspace", drainShape(live));
    else PASS(`dry-run sweep lists the live armed row (${live.calls} call(s), ${live.scanned} row(s) scanned)`, drainShape(live));
    if (live.deleted !== 0) FAIL("a DRY RUN deleted rows", drainShape(live));
    else PASS("dry run deleted nothing", { deleted: 0 });
  }

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
  const d1 = await drainSweep(true);
  ev.sweepBefore = drainShape(d1);
  let listedExpired = null;
  if (sweepUsable("pre-sweep dry run", d1)) {
    listedExpired = d1.expiredRows;
    if (d1.expiredRows < 1) FAIL("the dry run listed no expired row for a lever armed 8s ago with a 5s window", drainShape(d1));
    else PASS(`dry run lists ${d1.expiredRows} expired row(s), and deleted nothing`, drainShape(d1));
    if (d1.legacyNoUntil > 0) FAIL(`F-667 RESIDUAL: ${d1.legacyNoUntil} row(s) with no 'until'`, drainShape(d1));
    else PASS("no row in the keyspace lacks an 'until' stamp", { legacyNoUntil: 0 });
  }

  /* The REAL sweep is judged on its COUNTERS (`deleted`, `failed`), which stay whole even when
   * the row LIST is capped — so `listMustBeWhole` is false here. What is still not allowed is
   * a sweep that STOPPED: a partial delete pass compared against a full listing reads as a
   * failure to delete, and a partial listing compared against a full delete as a success. */
  const real = await drainSweep(false);
  ev.sweepReal = drainShape(real);
  if (sweepUsable("the real sweep", real, false)) {
    if (listedExpired === null) NV("the real sweep's delete count cannot be compared against anything: the pre-sweep listing was not usable", drainShape(real));
    else if (real.deleted >= listedExpired && real.failed === 0) PASS(`the real sweep deleted ${real.deleted} expired row(s) across ${real.calls} call(s), 0 failures`, drainShape(real));
    else FAIL("the real sweep did not delete every expired row it listed", { listed: listedExpired, ...drainShape(real) });
  }

  const d2 = await drainSweep(true);
  ev.sweepAfter = drainShape(d2);
  if (sweepUsable("post-sweep dry run", d2)) {
    if (d2.expiredRows === 0) PASS("second dry run: no expired row remains", drainShape(d2));
    else FAIL("expired rows survived the sweep", drainShape(d2));
  }

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
  /* THE CLOSING VERDICT (F-675). It used to be `liveRows === 0 && expiredRows === 0` over ONE
   * call's row list — a list capped at 200 rows, produced by a sweep that may have stopped on
   * its budget. 600 expired rows with 200 clean ones at the front printed PASS and exited 0.
   * It is now taken from a DRAINED dry run whose row list was never capped: `sweepUsable`
   * refuses an undrained sweep AND a `rowsTruncated:true` one, and each refusal is a FAIL that
   * names which of the two it was. `scanned` rides along so the verdict states how much of the
   * keyspace it actually looked at, rather than asserting over a page and calling it a whole. */
  const fin = await drainSweep(true);
  ev.finalSweep = drainShape(fin);
  if (sweepUsable("final dry-run sweep of the fault keyspace", fin)) {
    if (fin.liveRows === 0 && fin.expiredRows === 0) { passes++; say("PASS", `final dry-run sweep: the fault keyspace is clean (${fin.scanned} row(s) scanned across ${fin.calls} call(s))`, drainShape(fin)); }
    else { fails++; say("FAIL", `final dry-run sweep: ${fin.liveRows} live and ${fin.expiredRows} expired row(s) remain`, drainShape(fin)); }
  }

  ev.summary = { passes, fails, unproven };
  const file = `${OUT}/${ENV_NAME}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(file, JSON.stringify(redactSecrets(ev), null, 2));
  console.log(`\nPASS ${passes}  FAIL ${fails}  N/V ${unproven}`);
  console.log(`evidence: ${file}`);
  process.exit(fails > 0 ? 1 : 0);
}
