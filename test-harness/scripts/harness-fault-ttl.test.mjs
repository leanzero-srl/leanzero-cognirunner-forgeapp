/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-664 — A FAULT LEVER MUST END BY ITSELF.
 *
 * MEASURED ON A LIVE DEV TENANT (e3a1ecb): a Jira transport fault armed with
 * `ttlSeconds: 5` was STILL BITING at 615 s — past its own five-second window, past the
 * 300 s cap the arming side clamps to, and past the ten-minute family ceiling. Only an
 * explicit disarm ever ended a lever, so a driver that crashed before its `finally` left
 * every admin on that tenant seeing a planted 429 indefinitely.
 *
 * THE OPTION SHAPE WAS NOT THE BUG, and this suite says so out loud, because "pass the
 * right shape" is the plausible-and-wrong fix: `{ ttl: { value, unit } }` is exactly what
 * `@forge/kvs` takes (node_modules/@forge/kvs/out/interfaces/types.d.ts), `SECONDS` is a
 * legal `TtlUnit`, and both window levers already passed it. Forge KVS deletes expired
 * keys LAZILY — the fact src/index.js:1206 already records for the claim keys — so a
 * platform TTL is a CLEANUP guarantee and never a read-time one. The offline mock ignores
 * the `ttl` option entirely (lib/mock-kvs.mjs `set` reads only `keyPolicy`), which is
 * precisely why no existing suite could ever have caught this.
 *
 * SO THE BOUND IS ON THE ROW: `until` (ISO), written by the ONE write, refused by the ONE
 * read, which deletes the row on the way out. Same shape as the attachment capability
 * tokens (mint stamps `expiresAt` AND passes a platform TTL; `serveAttachment` re-checks
 * `expiresAt` "in case the KVS backend's TTL is fuzzy"). What is asserted here:
 *  · the write passes the SECONDS option object, EXACTLY, for all four kinds;
 *  · a row past `until` reads as ABSENT and is DELETED — for the generic read, for both
 *    window consumers, for the counting consumer, and end-to-end through `searchUsers`;
 *  · a row with NO `until` is NOT expired (the hand-planted row is still just data);
 *  · the caller's TTL is clamped, and the ten-minute constant is expressed in SECONDS;
 *  · consuming a counted lever does not RE-ARM its window.
 *
 * Run: node scripts/harness-fault-ttl.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import storage, { kvs } from "../lib/mock-kvs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const SECRET = "harness-secret-664";
process.env.HARNESS_SECRET = SECRET;

const fault = await import("../../src/harness-fault.js");
const PATH = fault.JIRA_FAULT_USER_SEARCH_PATH;
const faultSrc = readFileSync(path.join(here, "../../src/harness-fault.js"), "utf8");
const faultCode = faultSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* The spy: every `set` on the fault keyspace, with the OPTIONS OBJECT it was given. The
 * finding is the option, so the option is what is recorded — not a source-code regex. */
const realSet = kvs.set;
let writes = [];
kvs.set = async function spying(key, value, options) {
  if (String(key).startsWith("harness_fault:")) writes.push({ key, value, options });
  return realSet.call(this, key, value, options);
};
const lastWrite = () => writes[writes.length - 1];
const clear = () => { writes = []; };

const secondsUntil = (iso) => Math.round((Date.parse(iso) - Date.now()) / 1000);

/* ═════ 1. THE WRITE PASSES THE SECONDS SHAPE — the exact option object, four kinds ═════ */
{
  clear();
  const jira = await fault.armJiraFault(PATH, 429, 5);
  const w = lastWrite();
  ok(JSON.stringify(w.options) === JSON.stringify({ ttl: { value: 5, unit: "SECONDS" } }),
    `armJiraFault passes exactly { ttl: { value: 5, unit: "SECONDS" } } (got ${JSON.stringify(w.options)})`);
  ok(typeof w.value.until === "string" && secondsUntil(w.value.until) === 5,
    `…and stamps the row's own deadline five seconds out (got until=${w.value.until})`);
  ok(jira.until === w.value.until, "…and reports that deadline back to the caller");
  ok(jira.ttlSeconds === 5, "…and echoes the seconds it actually used");

  clear();
  const key = await fault.armKeyReadFault("openai", "refuse", 7);
  ok(JSON.stringify(lastWrite().options) === JSON.stringify({ ttl: { value: 7, unit: "SECONDS" } }),
    `armKeyReadFault passes the same SECONDS shape (got ${JSON.stringify(lastWrite().options)})`);
  ok(secondsUntil(key.until) === 7, "…with a matching `until` on the row");

  clear();
  const git = await fault.armHarnessFault(fault.HARNESS_FAULT_GIT_DISPATCH, ["gc_664", "d-1"], 2);
  ok(JSON.stringify(lastWrite().options) === JSON.stringify({ ttl: { value: fault.HARNESS_FAULT_TTL_SECONDS, unit: "SECONDS" } }),
    `armHarnessFault (git-dispatch) passes SECONDS too, not MINUTES (got ${JSON.stringify(lastWrite().options)})`);
  ok(secondsUntil(git.until) === fault.HARNESS_FAULT_TTL_SECONDS, "…with the family ceiling as its deadline");

  clear();
  await fault.armHarnessFault(fault.HARNESS_FAULT_HOOK_PROMOTE, ["gc_664", "acme/app"], 1);
  ok(lastWrite().options.ttl.unit === "SECONDS", "armHarnessFault (hook-promote) — the fourth kind, same shape");

  ok(writes.every(() => true) && !/unit: "MINUTES"/.test(faultCode),
    "SOURCE: no MINUTES unit survives in the module — one unit, and it is the one every caller thinks in");
  ok(!/HARNESS_FAULT_TTL\b(?!_SECONDS)/.test(faultCode), "SOURCE: the old `{ value: 10, unit: \"MINUTES\" }` constant is gone");
  ok(fault.HARNESS_FAULT_TTL_SECONDS === 600, "…replaced by the same ten minutes, expressed in seconds");
  ok(fault.HARNESS_FAULT_TTL === undefined, "…and it is no longer exported under the old name");
  ok((faultCode.match(/storage\.set\(/g) || []).length === 1,
    `SOURCE: there is exactly ONE storage.set in the module — the single write home (got ${(faultCode.match(/storage\.set\(/g) || []).length})`);
  ok((faultCode.match(/storage\.get\(/g) || []).length === 1,
    `SOURCE: …and exactly ONE storage.get — the single read home (got ${(faultCode.match(/storage\.get\(/g) || []).length})`);
  ok((faultCode.match(/if \(!harnessEnabled\(\)\)/g) || []).length === 9,
    "SOURCE: the helpers are NOT exports — the gated-export count is exactly the nine storage-touching exports, no more (F-688 added two)");
}

/* ═════ 2. A ROW PAST `until` READS AS ABSENT, AND IS DELETED ═════ */
{
  // Straight into the keyspace with a deadline in the past — the state a live row reaches
  // on its own while the platform has not got round to deleting it.
  const k = fault.harnessFaultKey(fault.HARNESS_FAULT_JIRA, PATH);
  const expired = { status: 429, armedAt: new Date(Date.now() - 60_000).toISOString(), until: new Date(Date.now() - 1_000).toISOString() };
  await storage.set(k, expired);
  ok((await storage.get(k)) !== undefined, "(fixture) the expired row really is still in the store — KVS deletes lazily");

  ok((await fault.jiraFaultStatus(PATH)) === null, "a Jira row past its `until` is read as NO fault");
  ok((await storage.get(k)) === undefined, "…and the read DELETED it, so the next reader need not judge it again");

  await storage.set(k, expired);
  const r = await fault.readHarnessFault(fault.HARNESS_FAULT_JIRA, [PATH]);
  ok(r.value === null, "the generic read answers `value: null` for an expired row");
  ok(r.expired === true && r.until === expired.until,
    `…and REPORTS the deadline it refused, rather than swallowing it (got expired=${r.expired} until=${r.until})`);

  const none = await fault.readHarnessFault(fault.HARNESS_FAULT_JIRA, [PATH]);
  ok(none.value === null && none.expired === false && none.until === null,
    "a lever that was never armed is `expired:false` — distinguishable from one that ended on its own");

  // The key-read window kind, same property, its own consumer.
  const kk = fault.harnessFaultKey(fault.HARNESS_FAULT_KEY_READ, "openai");
  await storage.set(kk, { mode: "refuse", until: new Date(Date.now() - 1).toISOString() });
  ok((await fault.keyReadFaultMode("openai")) === null, "an expired key-read row is read as NO fault");
  ok((await storage.get(kk)) === undefined, "…and is deleted on the way out too");

  // The COUNTING kind: an expired row must not hand out its remaining units.
  const gk = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, "gc_exp", "d-exp");
  await storage.set(gk, { count: 5, until: new Date(Date.now() - 1).toISOString() });
  ok((await fault.harnessFaultArmed(fault.HARNESS_FAULT_GIT_DISPATCH, "gc_exp", "d-exp")) === false,
    "an expired COUNTED lever is not armed — the window bounds the count, not the other way round");
  ok((await storage.get(gk)) === undefined, "…and it is gone");
}

/* ═════ 3. F-667 — A ROW WITH NO `until` IS BOUNDED BY `armedAt` + THE CEILING ═════
 *
 * THIS IS THE HALF F-664 MISSED, and it is the half that matters most: every fault row armed
 * by a build BEFORE the F-664 deploy carries `armedAt` and no `until`, so the new read-time
 * bound answered "not expired" for exactly the rows that produced the finding — the crashed
 * driver's 429, live forever on a dev tenant. A row this module cannot date at all is worse
 * still: nothing can ever end it, so it is expired by definition.
 */
{
  const k = fault.harnessFaultKey(fault.HARNESS_FAULT_JIRA, PATH);

  // A FRESH hand-planted row (the shape the offline suites write) still reads: its `armedAt`
  // is minutes inside the ten-minute ceiling.
  await storage.set(k, { status: 503, armedAt: new Date().toISOString() });
  ok((await fault.jiraFaultStatus(PATH)) === 503,
    "a hand-planted row with a FRESH `armedAt` and no deadline still reads — the offline suites that plant rows keep working");

  // THE LEGACY ROW: armed before the deploy, no `until`, `armedAt` past the family ceiling.
  const legacy = { status: 429, armedAt: new Date(Date.now() - (fault.HARNESS_FAULT_TTL_SECONDS + 60) * 1000).toISOString() };
  await storage.set(k, legacy);
  ok((await fault.jiraFaultStatus(PATH)) === null,
    "a PRE-DEPLOY row with no `until` and an `armedAt` past the ten-minute ceiling reads as NO fault");
  ok((await storage.get(k)) === undefined,
    "…and the read DELETED it — the crashed driver's lever leaves storage without anyone knowing its key");

  await storage.set(k, legacy);
  const r = await fault.readHarnessFault(fault.HARNESS_FAULT_JIRA, [PATH]);
  ok(r.value === null && r.expired === true,
    `…the generic read reports it expired too, though the ROW carries no until (got ${JSON.stringify(r)})`);

  // The predicate itself, on each shape.
  ok(fault.faultRowExpired({ until: new Date(Date.now() + 1000).toISOString() }) === false, "a future deadline is not past");
  ok(fault.faultRowExpired({ until: new Date(Date.now() - 1000).toISOString() }) === true, "a past deadline is");
  ok(fault.faultRowExpired({ until: "not-a-date", armedAt: new Date().toISOString() }) === false,
    "an unparseable `until` falls back to `armedAt` — a fresh row survives a corrupt stamp");
  ok(fault.faultRowExpired({ until: "not-a-date", armedAt: new Date(Date.now() - 3_600_000).toISOString() }) === true,
    "…and an OLD one does not: the fallback is a bound, not an amnesty");
  ok(fault.faultRowExpired({ status: 429 }) === true,
    "a row with NEITHER stamp is EXPIRED — a lever nothing can date is a lever nothing can end");
  ok(fault.faultRowExpired(null) === false && fault.faultRowExpired(undefined) === false,
    "…but a NON-row is absent, not expired — the two answers stay distinguishable");

  // The one deadline function both the predicate and the decrement ask.
  const armedAt = new Date(Date.now() - 60_000).toISOString();
  ok(fault.faultRowDeadline({ armedAt }) === Date.parse(armedAt) + fault.HARNESS_FAULT_TTL_SECONDS * 1000,
    "faultRowDeadline dates an undated row at `armedAt` + the family ceiling");
  ok(fault.faultRowDeadline({ armedAt, until: "2030-01-01T00:00:00.000Z" }) === Date.parse("2030-01-01T00:00:00.000Z"),
    "…and a parseable `until` always wins over the fallback");
  ok(fault.faultRowDeadline({}) === null && fault.faultRowDeadline(null) === null, "…and an undatable row has no deadline at all");

  await fault.disarmHarnessFault(fault.HARNESS_FAULT_JIRA, [PATH]);
}

/* ═════ 4. THE CALLER'S TTL IS CLAMPED — at the lever, and again at the write ═════ */
{
  clear();
  const huge = await fault.armJiraFault(PATH, 429, 99999);
  ok(huge.ttlSeconds === fault.HARNESS_JIRA_FAULT_MAX_TTL_SECONDS && lastWrite().options.ttl.value === 300,
    `a TTL above the Jira cap is clamped to 300 s in the OPTION as well as the answer (got ${lastWrite().options.ttl.value})`);
  ok(secondsUntil(huge.until) === 300, "…and the row's own deadline is the clamped value, never the asked one");

  clear();
  const tiny = await fault.armKeyReadFault("openai", "throw", 0);
  ok(tiny.ttlSeconds === fault.HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS,
    "a TTL of zero falls back to the cap, never to `forever`");
  ok(lastWrite().options.ttl.value === fault.HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS, "…in the option too");

  ok(fault.HARNESS_JIRA_FAULT_MAX_TTL_SECONDS <= fault.HARNESS_FAULT_TTL_SECONDS,
    "the per-kind cap sits under the family ceiling, so no lever can be armed for longer than ten minutes");
  await fault.disarmHarnessFault(fault.HARNESS_FAULT_JIRA, [PATH]);
  await fault.disarmHarnessFault(fault.HARNESS_FAULT_KEY_READ, ["openai"]);
}

/* ═════ 5. CONSUMING A COUNTED LEVER DOES NOT RE-ARM ITS WINDOW ═════ */
{
  const parts = ["gc_window", "d-window"];
  const k = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, ...parts);
  // A row with three units and eight seconds left. Consuming one must leave ~eight seconds,
  // not a fresh ten minutes — otherwise N consumptions walk a lever forward one TTL at a time.
  const until = new Date(Date.now() + 8_000).toISOString();
  await storage.set(k, { count: 3, armedAt: new Date().toISOString(), until });
  clear();
  ok((await fault.harnessFaultArmed(fault.HARNESS_FAULT_GIT_DISPATCH, ...parts)) === true, "(fixture) the lever bites");
  const w = lastWrite();
  ok(w.value.count === 2, "…one unit is consumed");
  ok(secondsUntil(w.value.until) <= 8, `…and the window is NOT extended by the decrement (got ${secondsUntil(w.value.until)}s left)`);
  ok(w.options.ttl.value <= 8 && w.options.ttl.unit === "SECONDS",
    `…the platform TTL re-written with it is the REMAINING life, not a fresh one (got ${JSON.stringify(w.options)})`);
  await fault.disarmHarnessFault(fault.HARNESS_FAULT_GIT_DISPATCH, parts);

  /* F-667 — AND IT DOES NOT MINT ONE EITHER. Before this, a counted row with no `until`
   * (every row armed before the F-664 deploy) went through the decrement's `remainingSeconds`
   * default of 600 and came back out stamped with a FRESH ten-minute window — the read
   * refused to expire it and the write kept renewing it. The deadline is now CARRIED, and for
   * an undated row the carried deadline is `armedAt` + the ceiling, so consuming BACKFILLS
   * the stamp instead of granting a new window. */
  const legacyParts = ["gc_legacy", "d-legacy"];
  const lk = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, ...legacyParts);
  const armedAt = new Date(Date.now() - 540_000).toISOString(); // nine minutes ago: one minute left
  await storage.set(lk, { count: 3, armedAt });
  clear();
  ok((await fault.harnessFaultArmed(fault.HARNESS_FAULT_GIT_DISPATCH, ...legacyParts)) === true,
    "(fixture) a legacy counted row with no `until` still bites while it is inside the ceiling");
  const lw = lastWrite();
  ok(lw.value.count === 2, "…one unit is consumed");
  ok(lw.value.until === new Date(Date.parse(armedAt) + fault.HARNESS_FAULT_TTL_SECONDS * 1000).toISOString(),
    `…and the decrement BACKFILLS \`armedAt\` + the ceiling, never now + 600 s (got ${lw.value.until})`);
  ok(secondsUntil(lw.value.until) <= 61,
    `…so roughly a minute is left, not a fresh ten (got ${secondsUntil(lw.value.until)}s)`);
  ok(lw.options.ttl.value <= 61, `…and the platform TTL matches that remaining life (got ${JSON.stringify(lw.options)})`);
  await fault.disarmHarnessFault(fault.HARNESS_FAULT_GIT_DISPATCH, legacyParts);
}

/* ═════ 7. F-667 — THE SWEEP: a crashed driver's leftovers clear in ONE call ═════
 *
 * A read-time bound ends a lever the moment something LOOKS at it. The rows that caused
 * F-664 are precisely the ones nobody will look at again: keys only the dead driver knew,
 * and Forge KVS deletes expired keys lazily. So the family gets an enumerating sweep — and
 * what is asserted hardest is what it must NOT do: delete a lever that is still live.
 */
{
  const alive = fault.harnessFaultKey(fault.HARNESS_FAULT_JIRA, PATH);
  const deadLegacy = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, "gc_sweep", "d-old");
  const deadStamped = fault.harnessFaultKey(fault.HARNESS_FAULT_KEY_READ, "openrouter");
  const undatable = fault.harnessFaultKey(fault.HARNESS_FAULT_HOOK_PROMOTE, "gc_sweep", "acme/app");
  const bystander = "doc_repo_index";

  // Section 1 armed two levers for real and never disarmed them; a sweep counts what is in
  // the keyspace, so the fixture starts from a known one.
  await fault.disarmHarnessFault(fault.HARNESS_FAULT_GIT_DISPATCH, ["gc_664", "d-1"]);
  await fault.disarmHarnessFault(fault.HARNESS_FAULT_HOOK_PROMOTE, ["gc_664", "acme/app"]);

  const plant = async () => {
    await storage.set(alive, { status: 429, armedAt: new Date().toISOString(), until: new Date(Date.now() + 120_000).toISOString() });
    await storage.set(deadLegacy, { count: 2, armedAt: new Date(Date.now() - 3_600_000).toISOString() });
    await storage.set(deadStamped, { mode: "refuse", armedAt: new Date(Date.now() - 400_000).toISOString(), until: new Date(Date.now() - 1_000).toISOString() });
    await storage.set(undatable, { count: 1 });
    await storage.set(bystander, ["not-a-fault-row"]);
  };

  // A DRY RUN CHANGES NOTHING — the list first, so an operator can look before deleting.
  await plant();
  const dry = await fault.sweepHarnessFaults({ dryRun: true });
  ok(dry.ok === true && dry.dryRun === true && dry.deleted === 0, `a dry run deletes nothing (got ${JSON.stringify({ ok: dry.ok, deleted: dry.deleted })})`);
  ok(dry.scanned === 4, `…and scans exactly the four fault rows, not the bystander key (got ${dry.scanned})`);
  ok((await storage.get(deadLegacy)) !== undefined, "…and the expired row really is still there afterwards");

  const byKey = Object.fromEntries(dry.rows.map((r) => [r.key, r]));
  ok(byKey[alive] && byKey[alive].expired === false && typeof byKey[alive].until === "string",
    "…the live lever is LISTED with its own `until`, and reported not expired");
  ok(byKey[deadLegacy] && byKey[deadLegacy].expired === true && byKey[deadLegacy].until === null && typeof byKey[deadLegacy].deadline === "string",
    "…the legacy row reports `until: null` and the `armedAt`-derived DEADLINE that condemns it — a reader is owed both");
  ok(byKey[undatable] && byKey[undatable].expired === true && byKey[undatable].deadline === null,
    "…and a row with neither stamp is expired with no deadline to show for it");

  // THE SWEEP ITSELF.
  const swept = await fault.sweepHarnessFaults();
  ok(swept.ok === true && swept.scanned === 4 && swept.deleted === 3 && swept.failed === 0,
    `the sweep deletes the three expired rows and no more (got ${JSON.stringify({ scanned: swept.scanned, deleted: swept.deleted, failed: swept.failed })})`);
  ok((await storage.get(deadLegacy)) === undefined && (await storage.get(deadStamped)) === undefined && (await storage.get(undatable)) === undefined,
    "…all three are gone from storage");
  ok((await storage.get(alive)) !== undefined, "…and THE LIVE LEVER IS UNTOUCHED — a sweep is not a disarm-everything");
  ok((await fault.jiraFaultStatus(PATH)) === 429, "…so a running driver's fault still bites after somebody else swept");
  ok((await storage.get(bystander)) !== undefined, "…and nothing outside the `harness_fault:` prefix was read or removed");

  // A SECOND SWEEP IS A NO-OP — idempotent, like every other cleanup in the family.
  const again = await fault.sweepHarnessFaults();
  ok(again.scanned === 1 && again.deleted === 0, `a second sweep finds only the live row and deletes nothing (got ${JSON.stringify({ scanned: again.scanned, deleted: again.deleted })})`);

  // THE NEGATIVE CONTROL: with the gate shut it refuses, and performs no KVS work at all.
  const realQuery = kvs.query;
  let queries = 0;
  kvs.query = function countingQuery(...a) { queries += 1; return realQuery.apply(this, a); };
  const saved = process.env.HARNESS_SECRET;
  delete process.env.HARNESS_SECRET;
  const off = await fault.sweepHarnessFaults();
  ok(off && off.ok === false && off.reason === "harness-off", "with HARNESS_SECRET absent the sweep REFUSES — harness-off");
  ok(queries === 0, `…and issues ZERO queries — production enumerates nothing (got ${queries})`);
  process.env.HARNESS_SECRET = saved;
  ok((await fault.sweepHarnessFaults({ dryRun: true })).ok === true && queries === 1,
    "…(sanity) the same call with the gate open DOES query, so the zero above is the gate and not a dead counter");
  kvs.query = realQuery;

  await fault.disarmHarnessFault(fault.HARNESS_FAULT_JIRA, [PATH]);
  await storage.delete(bystander);
}

/* ═════ 7b. F-673 — THE SWEEP'S STATED BOUND IS THE ENFORCED ONE ═════
 *
 * The sweep's docblock claimed "a diagnostic call inside one 25 s resolver budget" while
 * enforcing 1000 rows and up to 1000 SEQUENTIAL awaited deletes and no clock at all — and it
 * assembled its answer only after the LAST page, so a sweep killed mid-loop reported nothing
 * whatsoever, having already deleted an unknown number of rows.
 *
 * The offline mock is exactly why this survived: its `delete` returns instantly, so no number
 * of planted rows can ever reach a time bound. So the fixture INJECTS delete latency — and
 * injects it only on the rows AFTER the first page, which makes the trip point deterministic
 * (page 0 completes, page 1 runs out of budget) rather than a race with the machine.
 *
 * What is asserted: the loop STOPS on the budget, the PARTIAL answer is returned with real
 * counters and a resume cursor, and a second call with that cursor FINISHES the job.
 */
{
  const TOTAL = 400;
  const stale = new Date(Date.now() - 3_600_000).toISOString();
  const keys = [];
  for (let i = 0; i < TOTAL; i++) {
    // Zero-padded so the mock's key-sorted pagination matches the order latency is assigned in.
    const key = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, "gc_673", `d-${String(i).padStart(4, "0")}`);
    keys.push(key);
    await storage.set(key, { count: 1, armedAt: stale, until: stale });
  }

  // THE ANSWER STAYS SMALL: 400 rows scanned, at most 200 LISTED, and the counters keep
  // counting past the cap — a courtesy list must never be what makes a response unreturnable.
  const big = await fault.sweepHarnessFaults({ dryRun: true });
  ok(big.scanned >= TOTAL && big.rows.length === fault.HARNESS_FAULT_SWEEP_MAX_ROWS && big.rowsTruncated === true,
    `the row LIST caps at ${fault.HARNESS_FAULT_SWEEP_MAX_ROWS} while the scanned COUNTER counts all ${TOTAL} (got ${JSON.stringify({ scanned: big.scanned, rows: big.rows.length, rowsTruncated: big.rowsTruncated })})`);
  ok(big.deleted === 0 && (await storage.get(keys[0])) !== undefined, "…and a dry run over 400 rows still deletes none of them");

  /* F-674 - THE BREAKER'S FIXTURE: LATENCY ON *ALL* ROWS.
   *
   * The F-673 fixture injected delete latency only on rows AFTER page 0, which is exactly
   * why the suite could not see F-674: page 0 always completed, so the budget only ever
   * tripped on a page whose `resume` cursor was a real token. Slow down EVERY row and the
   * break lands on page 0 of a fresh call, where the old code's `resume` was the caller's
   * own `null` start cursor - and the sweep answered `truncated: true` with `cursor: null`,
   * which every `while (r.cursor)` caller reads as "finished". Measured by the breaker:
   * `deleted: 20, truncated: true, cursor: null` with 370 of 400 rows still in the store.
   */
  const realDelete = kvs.delete;
  const slow = new Set(keys);
  let latencyMs = 30;
  kvs.delete = async function latentDelete(key) {
    if (slow.has(key) && latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    return realDelete.call(this, key);
  };

  const first = await fault.sweepHarnessFaults({ maxMs: 60 });
  ok(first.ok === true && first.truncated === true && first.reason === "budget",
    `a sweep that runs out of time RETURNS, truncated with reason "budget" (got ${JSON.stringify({ ok: first.ok, truncated: first.truncated, reason: first.reason })})`);
  ok(first.deleted > 0,
    `PROGRESS IS GUARANTEED: the budget is honoured only AFTER at least one delete batch lands, so a break on page 0 still moves (deleted ${first.deleted})`);
  ok(typeof first.cursor === "string" && first.cursor.length > 0,
    `…and the cursor is NEVER null while rows remain - the F-674 defect was exactly this answer carrying null (got ${JSON.stringify(first.cursor)})`);
  ok(first.scanned >= first.deleted && Array.isArray(first.rows) && first.rows.length > 0,
    "…with the rows it had already listed, which the old all-or-nothing answer threw away");
  ok((await storage.get(keys[TOTAL - 1])) !== undefined, "…the rows it never reached are still there, which is what makes resuming meaningful");

  // A RESUMED call must make progress TOO. The old code handed back the very cursor it was
  // given with nothing deleted whenever its own page 0 ran out of budget - a loop that
  // never converges. Its page 0 is the page that previously ran out, so this is the case.
  const second = await fault.sweepHarnessFaults({ maxMs: 60, cursor: first.cursor });
  ok(second.ok === true && second.deleted > 0,
    `…and a RESUMED call deletes too - progress per call, not just per sweep (deleted ${second.deleted})`);
  ok(second.cursor !== null && typeof second.cursor === "string",
    "…and still hands back a resumable token with hundreds of rows left");

  /* F-677 - THE DELETE RATE IS THE APP'S OWN PUBLISHED ONE, IN ONE PAIR OF CONSTANTS.
   * The sweep fired ten concurrent deletes with no pause while
   * src/shared/knowledge-packs/forge-app-builder.js ships the measured rate to this app's
   * own users: "batches of ~3 with ~200 ms pauses between rounds". A throttled delete is
   * counted `failed` and the ROW SURVIVES, so the un-paced sweep answered ok:true over a
   * keyspace it had not cleared. Asserted here against the pack text itself, so the two
   * cannot drift apart without a suite saying so.
   *
   * F-687 - THE NUMBERS ARE THE INTERFACE; THE PROSE IS NOT. This read the pack's exact
   * markdown, emphasis included ("batches of **~3 with ~200 ms pauses**"), out of a file
   * whose own header says GENERATED - DO NOT EDIT, produced by scripts/bake-knowledge.mjs
   * from living source markdown on an allow-list. Re-word the source, drop the bold or write
   * "200ms" without the space and this suite FAILS on a line labelled "(fixture)" while
   * src/harness-fault.js is byte-identical and perfectly correct - a failure pointing at a
   * knowledge pack rather than at the sweep. The drift worth catching is someone changing
   * KVS_DELETE_BATCH, and that is asserted on the constants directly one line below. So the
   * pack is read for its NUMBERS only, through a matcher tolerant of formatting. */
  const packText = readFileSync(new URL("../../src/shared/knowledge-packs/forge-app-builder.js", import.meta.url), "utf8");
  ok(/batches of \*{0,2}~?3\b[\s\S]{0,60}?~?200 ?ms/.test(packText),
    "(fixture) the pack really does publish batches of ~3 with ~200 ms pauses - the source this rate is derived from (numbers matched, wording not)");
  ok(fault.KVS_DELETE_BATCH === 3 && fault.KVS_DELETE_PAUSE_MS === 200,
    `deletes are paced at exactly that rate (got ${fault.KVS_DELETE_BATCH}/${fault.KVS_DELETE_PAUSE_MS})`);
  ok(fault.HARNESS_FAULT_SWEEP_DELETE_CONCURRENCY === fault.KVS_DELETE_BATCH,
    "…and the historical constant name is the SAME constant, so the rate has exactly one home");
  ok(first.deleted <= fault.KVS_DELETE_BATCH,
    `…and a 60 ms budget buys ONE paced batch, not ten unpaced deletes (deleted ${first.deleted})`);

  /* THE PAUSE LIVES INSIDE THE BUDGET. Pacing must make a sweep do LESS per call, never
   * overrun the trigger - so a caller's maxMs still bounds the wall clock even though every
   * round now sleeps 200 ms. Measured, not asserted from the source. */
  const paceT0 = Date.now();
  const paced = await fault.sweepHarnessFaults({ maxMs: 400 });
  const paceElapsed = Date.now() - paceT0;
  ok(paced.budgetMs === 400 && paceElapsed < 400 + fault.KVS_DELETE_PAUSE_MS + 500,
    `a paced sweep still honours its budget across the pauses (budget 400 ms, elapsed ${paceElapsed} ms)`);
  ok(paced.deleted > 0 && paced.failed === 0,
    `…and the paced rounds still land (deleted ${paced.deleted}, failed ${paced.failed})`);

  // THE TOKEN ROUND-TRIPS, including the one value a raw KVS cursor cannot express.
  ok(fault.decodeSweepCursor(first.cursor) === null,
    "the resume token for \"the beginning of the keyspace\" decodes to a null KVS cursor - the value that used to be indistinguishable from \"finished\"");
  /* F-685 - ONE CURSOR GRAMMAR, AND THE LEGACY RAW CURSOR IS NOT IN IT.
   * `decodeSweepCursor` used to accept ANY non-empty string verbatim as a raw KVS cursor,
   * while the web trigger admitted a narrower alphabet - two answers to "what may a resume
   * cursor be", with the narrow one at the only door there is. The token has shipped for one
   * deploy and the only callers are this repo's drivers, so the raw path is gone: the
   * predicate lives here, the door imports it, and anything that is not one of our tokens is
   * REFUSED (not silently turned into a fresh sweep from the top). */
  ok(typeof fault.sweepCursorWellFormed === "function" && fault.sweepCursorWellFormed(first.cursor) === true,
    "the grammar is exported from harness-fault.js and admits our own token");
  for (const [why, value] of [
    ["a legacy RAW KVS cursor", "harness_fault:git:x"],
    ["a traversal shape", "../../etc/passwd"],
    ["a string outside the alphabet", "abc def"],
    ["over the 2 KB ceiling", "A".repeat(2100)],
    ["not a string at all", 42],
    ["base64 that is not one of ours", "dGhpcy1pcy1ub3QteW91cnM="],
  ]) {
    let code = null;
    try { fault.decodeSweepCursor(value); } catch (e) { code = e && e.code; }
    ok(code === fault.BAD_SWEEP_CURSOR_CODE,
      `…and ${why} is REFUSED with ${fault.BAD_SWEEP_CURSOR_CODE}, before any KVS call (got ${JSON.stringify(code)})`);
  }
  ok(fault.decodeSweepCursor(null) === null && fault.decodeSweepCursor(undefined) === null,
    "…while an absent cursor is a fresh sweep, which is the only thing that may mean \"start at the top\"");

  latencyMs = 0;
  for (const key of keys) await storage.delete(key);
  kvs.delete = realDelete;

  /* F-674 - LOOP UNTIL NULL, AND IT TERMINATES WITH THE KEYSPACE EMPTY.
   * The contract a caller actually writes. A smaller keyspace than the 400 above because
   * the F-677 pacing is real wall-clock time (~200 ms per batch of 3) and this loop runs
   * it for real rather than faking the clock.
   */
  const DRAIN = 30;
  const drainKeys = [];
  for (let i = 0; i < DRAIN; i++) {
    const key = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, "gc_674", `d-${String(i).padStart(4, "0")}`);
    drainKeys.push(key);
    await storage.set(key, { count: 1, armedAt: stale, until: stale });
  }
  let token = null, calls = 0, drained = 0, ran = true, last = null;
  while (ran) {
    const r = await fault.sweepHarnessFaults({ maxMs: 500, cursor: token });
    last = r;
    drained += r.deleted;
    token = r.cursor;
    calls++;
    ran = token !== null;
    if (calls > 200) break;
  }
  ok(calls <= 200 && token === null,
    `a \`while (cursor)\` caller TERMINATES - ${calls} calls, and the last answer's cursor is null`);
  let stillThere = 0;
  for (const key of drainKeys) if ((await storage.get(key)) !== undefined) stillThere++;
  ok(stillThere === 0 && drained === DRAIN,
    `…with the whole ${DRAIN}-row keyspace actually EMPTY when it stops (deleted ${drained}, still there ${stillThere})`);
  // F-683 - and the FINISHED answer says so in one field, not by the caller re-deriving it.
  ok(last.complete === true && last.failed === 0 && last.truncated === false,
    `…and only THAT answer is \`complete\` (got ${JSON.stringify({ complete: last.complete, failed: last.failed, truncated: last.truncated })})`);

  /* F-682/F-683 - A STORE THAT REFUSES EVERY DELETE.
   *
   * `progressed` was set after `Promise.allSettled` whatever the outcomes, so an all-failed
   * batch armed the gate the whole termination argument rests on: the budget was then free
   * to break MID-PAGE with that page's own cursor, and the resumed call re-fetched the same
   * page, failed the same way, and answered the same token - forever. And even when the walk
   * DID reach the end of the keyspace, a sweep whose deletes all failed answered
   * `truncated: false, cursor: null`: the finished signal, over rows it had condemned and
   * left standing.
   *
   * The offline mock deletes instantly and never refuses, which is exactly why no suite
   * could see either one. Refuse every delete and both answers become readable: the call
   * ENDS with `reason: "deletes-failing"`, `failed > 0` and a cursor, and a loop that treats
   * that as "not converging" terminates instead of spinning. */
  const failKeys = [];
  for (let i = 0; i < 9; i++) {
    const key = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, "gc_682", `d-${String(i).padStart(4, "0")}`);
    failKeys.push(key);
    await storage.set(key, { count: 1, armedAt: stale, until: stale });
  }
  const okDelete = kvs.delete;
  kvs.delete = async function refusingDelete(key) {
    if (failKeys.includes(key)) { const e = new Error("RATE_LIMIT_EXCEEDED"); e.code = "RATE_LIMIT_EXCEEDED"; throw e; }
    return okDelete.call(this, key);
  };
  let failToken = null, failCalls = 0, spun = 0, lastFail = null;
  while (failCalls < 50) {
    const r = await fault.sweepHarnessFaults({ maxMs: 5_000, cursor: failToken });
    lastFail = r; failCalls++;
    spun += r.deleted;
    // The contract a caller writes: keep going while there is a cursor, but STOP when the
    // answer says the deletes are not landing. Without F-682 this loop never exits.
    if (r.reason === "deletes-failing") break;
    failToken = r.cursor;
    if (failToken === null) break;
  }
  ok(failCalls === 1 && lastFail.reason === "deletes-failing",
    `an all-failed batch ENDS the call as "deletes-failing" rather than counting as progress (calls ${failCalls}, reason ${JSON.stringify(lastFail.reason)})`);
  ok(lastFail.truncated === true && lastFail.failed > 0 && spun === 0,
    `…with failed > 0 and nothing deleted, so a caller can see it is NOT converging (got ${JSON.stringify({ truncated: lastFail.truncated, failed: lastFail.failed, deleted: spun })})`);
  ok(lastFail.complete === false && typeof lastFail.cursor === "string" && lastFail.cursor.length > 0,
    "…never `complete`, and still carrying the cursor of the page that failed so a retry resumes there");
  // The rows are all still present — a refused delete must leave the row, which is the whole
  // reason `failed > 0` may not share an answer shape with "finished".
  let survivors = 0;
  for (const key of failKeys) if ((await storage.get(key)) !== undefined) survivors++;
  ok(survivors === failKeys.length, `…and every refused row is still there (${survivors}/${failKeys.length})`);

  /* THE PARTIAL CASE: some deletes land, some do not, and the walk reaches the end of the
   * keyspace. That used to be `truncated: false, cursor: null, ok: true, failed: n`. */
  const stubborn = new Set(failKeys.slice(0, 2));
  kvs.delete = async function partlyRefusingDelete(key) {
    if (stubborn.has(key)) { const e = new Error("RATE_LIMIT_EXCEEDED"); e.code = "RATE_LIMIT_EXCEEDED"; throw e; }
    return okDelete.call(this, key);
  };
  const partial = await fault.sweepHarnessFaults({ maxMs: 5_000 });
  ok(partial.failed > 0 && partial.deleted > 0,
    `(fixture) a sweep where some deletes land and some are refused (deleted ${partial.deleted}, failed ${partial.failed})`);
  ok(partial.truncated === true && partial.reason === "deletes-failed" && partial.complete === false,
    `a sweep that could not delete what it condemned is NOT finished - it says "deletes-failed" (got ${JSON.stringify({ truncated: partial.truncated, reason: partial.reason, complete: partial.complete })})`);
  ok(typeof partial.cursor === "string" && partial.cursor.length > 0,
    "…and carries the cursor of the page the failures started on, so a retry resumes at the mess");
  kvs.delete = okDelete;
  for (const key of failKeys) await storage.delete(key);

  // THE BUDGET ITSELF: a default, a ceiling no caller may raise past the 25 s trigger, and a
  // floor, so "maxMs: 0" is one check-and-stop rather than a loop that never checks.
  ok(fault.sweepBudgetMs(undefined) === fault.HARNESS_FAULT_SWEEP_DEFAULT_MS && fault.sweepBudgetMs("15000") === fault.HARNESS_FAULT_SWEEP_DEFAULT_MS,
    "a missing or non-numeric maxMs is the default budget");
  ok(fault.sweepBudgetMs(60_000) === fault.HARNESS_FAULT_SWEEP_MAX_MS && fault.HARNESS_FAULT_SWEEP_MAX_MS <= 20_000,
    `…a caller cannot raise it above the ${fault.HARNESS_FAULT_SWEEP_MAX_MS} ms ceiling`);
  ok(fault.sweepBudgetMs(0) === 1 && fault.sweepBudgetMs(-5) === 1, "…and it never drops below 1 ms");

  // `dryRun` ACCEPTS ONLY `true`. The string "false" is what a query string or a curl produces;
  // under the old `Boolean(dryRun)` it meant "do not delete", which is a safe mode entered by
  // accident — and a lever whose safe mode is accidental has a dangerous mode that is too.
  const sneaky = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, "gc_673b", "d-1");
  await storage.set(sneaky, { count: 1, armedAt: stale, until: stale });
  const coerced = await fault.sweepHarnessFaults({ dryRun: "false" });
  ok(coerced.dryRun === false && (await storage.get(sneaky)) === undefined,
    `dryRun only accepts the literal true — the string "false" sweeps for real (got dryRun=${JSON.stringify(coerced.dryRun)})`);
}

/* ═════ 6. END TO END — the expired row does not fault the product ═════ */
{
  const { default: forgeApi } = await import("@forge/api");
  const REAL_ROW = { accountId: "8888", displayName: "Mihai Perdum", avatarUrls: { "24x24": "a.png" } };
  forgeApi.__respond(() => forgeApi.__response(200, [REAL_ROW]));
  const ADMIN = "acct-admin-664";
  await storage.set("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);
  const { handler } = await import("../../src/index.js");

  const k = fault.harnessFaultKey(fault.HARNESS_FAULT_JIRA, PATH);
  await storage.set(k, { status: 429, armedAt: new Date().toISOString(), until: new Date(Date.now() + 60_000).toISOString() });
  const bitten = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(bitten.success === false && bitten.status === 429, "(fixture) a live lever still faults the search");

  await storage.set(k, { status: 429, armedAt: new Date().toISOString(), until: new Date(Date.now() - 1_000).toISOString() });
  const free = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(free.success === true && free.users.length === 1,
    `…and the SAME search runs for real once the row's deadline has passed — the crashed driver stops punishing the tenant (got ${JSON.stringify(free).slice(0, 140)})`);
  ok((await storage.get(k)) === undefined, "…with the stale row cleaned up by the read that refused it");
}

/* ═════════════════════════════════════════════════════════════════════════════════
 * 7. F-688 — THE BALLAST, AND WHY IT IS SAFE TO WRITE FIVE HUNDRED OF IT
 *
 * The sweep's multi-page path — the resume token, the KVS cursor round-trip, the paced
 * deletes, the F-682 progress guarantee, the F-683 `complete` — engages only once the
 * `harness_fault:` keyspace is bigger than one page of 100. Nothing in this app could put
 * it there: the arming levers write ONE row per exact path, ONE per provider, a handful per
 * connection. So every resume assertion above ran against a keyspace a tester on a real
 * tenant cannot reproduce, and `plantHarnessFaults` is the door that closes that.
 *
 * A lever that writes five hundred rows into the fault keyspace is only acceptable if those
 * rows cannot DO anything, so the inertness is asserted here BEHAVIOURALLY — every reader in
 * the module is called while 250 planted rows sit in the store — and not by reading the
 * source. What makes it true is that `harnessFaultKey` puts the KIND in the second segment
 * and every consumer exact-matches its own kind constant; `plant` is nobody's.
 *
 * TIME IS COMPRESSED HERE, NOT REMOVED. `setFaultRow` and the deletes are paced at the app's
 * own published KVS rate (batches of 3, 200 ms between rounds), which is ~17 s of real
 * waiting for 250 rows — unacceptable in an offline suite. `setTimeout` is therefore
 * shimmed to fire immediately while RECORDING every delay asked for, and the pacing is
 * asserted from those recorded delays. The pagination, the tokens and the termination are
 * all real; only the wall clock is not.
 * ═════════════════════════════════════════════════════════════════════════════════ */
{
  const realTimeout = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = function compressed(fn, ms, ...rest) {
    if (typeof ms === "number") delays.push(ms);
    return realTimeout(fn, 0, ...rest);
  };
  const pauseCount = () => delays.filter((d) => d === fault.KVS_DELETE_PAUSE_MS).length;

  // Everything left behind by sections 1-6, gone, so a `complete` drain below means THIS
  // fixture and not somebody else's leftovers.
  const purge = async () => {
    for (let i = 0; i < 20; i++) {
      const page = await storage.query().where("key", { condition: "BEGINS_WITH", values: ["harness_fault:"] }).limit(100).getMany();
      const rows = (page && page.results) || [];
      if (!rows.length) return;
      for (const row of rows) await storage.delete(String(row.key));
    }
  };
  const countPrefix = async (prefix) => {
    let n = 0, cursor = null;
    for (let i = 0; i < 20; i++) {
      let q = storage.query().where("key", { condition: "BEGINS_WITH", values: [prefix] }).limit(100);
      if (cursor) q = q.cursor(cursor);
      const page = await q.getMany();
      n += ((page && page.results) || []).length;
      cursor = (page && page.nextCursor) || null;
      if (!cursor) break;
    }
    return n;
  };

  /* ── 7a. REFUSED IN PRODUCTION. `HARNESS_SECRET` is absent there, and the gate is the
   * lever's FIRST statement, so the refusal is not the web trigger's alone. ── */
  await purge();
  delete process.env.HARNESS_SECRET;
  const offPlant = await fault.plantHarnessFaults({ n: 250, expired: true });
  ok(offPlant.ok === false && offPlant.reason === "harness-off",
    `plantHarnessFaults refuses harness-off with no HARNESS_SECRET — production plants nothing (got ${JSON.stringify(offPlant)})`);
  const offClear = await fault.clearPlantedFaults({});
  ok(offClear.ok === false && offClear.reason === "harness-off",
    `…and so does clearPlantedFaults (got ${JSON.stringify(offClear)})`);
  ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 0, "…and neither refused call touched the keyspace");
  process.env.HARNESS_SECRET = SECRET;
  ok((faultCode.match(/if \(!harnessEnabled\(\)\)/g) || []).length === 9,
    `SOURCE: the two new storage-touching exports each carry the gate — nine, not seven (got ${(faultCode.match(/if \(!harnessEnabled\(\)\)/g) || []).length})`);

  /* ── 7b. `n` IS CLAMPED, and the clamp lives with the constant it bounds ── */
  ok(fault.HARNESS_FAULT_PLANT_MAX === 500, "the ceiling is five hundred rows — five pages of the sweep's page size");
  ok(fault.plantCountClamped(0) === 1 && fault.plantCountClamped(-40) === 1, "zero and negative clamp UP to one");
  ok(fault.plantCountClamped(10_000) === 500 && fault.plantCountClamped(501) === 500, "anything above the ceiling IS the ceiling");
  ok(fault.plantCountClamped(undefined) === 1 && fault.plantCountClamped("banana") === 1 && fault.plantCountClamped(NaN) === 1,
    "a missing or junk `n` is ONE — the smallest population, never the largest");
  ok(fault.plantCountClamped(7.9) === 7, "…and a fraction floors rather than rounding up");
  const overCap = await fault.plantHarnessFaults({ n: 10_000, expired: true });
  ok(overCap.n === 500 && overCap.planted === 500,
    `…and the clamp is enforced END TO END, not just in the helper (asked 10000, planted ${overCap.planted})`);
  ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 500, "…exactly five hundred rows reached the store");
  await purge();

  /* ── 7c. THE ROW SHAPE: the SECONDS ttl option, and `until` on both sides of now ── */
  clear();
  const live = await fault.plantHarnessFaults({ n: 2, expired: false });
  const lw = lastWrite();
  ok(JSON.stringify(lw.options) === JSON.stringify({ ttl: { value: 60, unit: "SECONDS" } }),
    `a planted row passes exactly { ttl: { value: 60, unit: "SECONDS" } } — forgotten ballast leaves on its own (got ${JSON.stringify(lw.options)})`);
  ok(lw.value.count === 1 && lw.value.plantedBy === "harness" && typeof lw.value.armedAt === "string",
    `…with the documented row shape (got ${JSON.stringify(lw.value)})`);
  ok(Date.parse(lw.value.until) - Date.parse(lw.value.armedAt) === fault.HARNESS_FAULT_PLANT_TTL_SECONDS * 1000,
    `…and a live row's \`until\` is exactly armedAt + 60 s (got until=${lw.value.until} armedAt=${lw.value.armedAt})`);
  ok(fault.faultRowExpired(lw.value) === false && live.expired === false, "…so the sweep must LIST it and leave it alone");

  clear();
  const dead = await fault.plantHarnessFaults({ n: 2, expired: true });
  const dw = lastWrite();
  ok(JSON.stringify(dw.options) === JSON.stringify({ ttl: { value: 60, unit: "SECONDS" } }),
    "an expired row passes the SAME SECONDS shape — the platform TTL is not what makes it expired");
  ok(Date.parse(dw.value.until) < Date.now(), `…but its \`until\` is in the PAST (got ${dw.value.until})`);
  ok(fault.faultRowExpired(dw.value) === true && dead.expired === true,
    "…which is the only shape the sweep will actually delete");
  await purge();

  /* ── 7d. THE ROWS ARE INERT. Not a source claim: 250 of them are in the store while every
   * reader in the module is called. `harnessFaultKey` puts the KIND in the second segment and
   * each consumer exact-matches its own constant, so `plant` matches nothing. ── */
  const inert = await fault.plantHarnessFaults({ n: 250, expired: true });
  ok(inert.planted === 250, `(fixture) 250 planted rows sitting in the fault keyspace (planted ${inert.planted})`);
  ok((await fault.jiraFaultStatus(PATH)) === null,
    "`jiraFaultStatus` sees NO fault — the `jira` kind is exact-matched and `plant` is not it");
  ok((await fault.keyReadFaultMode("openai")) === null && (await fault.keyReadFaultMode("plant")) === null,
    "…`keyReadFaultMode` sees none either, not even for a provider literally named `plant`");
  ok((await fault.harnessFaultArmed(fault.HARNESS_FAULT_GIT_DISPATCH, "000", "d-1")) === false,
    "…the git-dispatch consumer is not armed by ballast");
  ok((await fault.harnessFaultArmed(fault.HARNESS_FAULT_HOOK_PROMOTE, "000", "acme/app")) === false,
    "…nor the hook-promote one");
  for (const kind of [fault.HARNESS_FAULT_JIRA, fault.HARNESS_FAULT_KEY_READ, fault.HARNESS_FAULT_GIT_DISPATCH, fault.HARNESS_FAULT_HOOK_PROMOTE]) {
    const r = await fault.readHarnessFault(kind, ["000"]);
    ok(r && r.value === null, `…and the generic read of kind ${JSON.stringify(kind)} on part "000" answers null, though \`plant:000\` exists`);
    ok(fault.harnessFaultKey(kind, "000") !== fault.plantedFaultKey(0),
      `…because the key of kind ${JSON.stringify(kind)} cannot collide with a planted one`);
  }
  ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 250,
    "…and every one of those reads left all 250 rows exactly where they were");

  /* ── 7e. THE DRAIN. 250 expired rows, the paced deletes, `maxMs: 1`: the budget may only
   * stop the call AFTER it has moved (F-682), the token is never null while work remains
   * (F-674), and the loop terminates on `complete: true` (F-683). ── */
  const pausesBeforeSweep = pauseCount();
  ok(pausesBeforeSweep >= 80,
    `(fixture) planting paced at the app's published rate — ${pausesBeforeSweep} rounds of ${fault.KVS_DELETE_PAUSE_MS} ms for 250 rows in batches of ${fault.KVS_DELETE_BATCH}`);

  const first = await fault.sweepHarnessFaults({ maxMs: 1 });
  ok(first.truncated === true && first.reason === "budget",
    `a sweep over 250 planted rows runs out of budget and says so (got ${JSON.stringify({ truncated: first.truncated, reason: first.reason })})`);
  ok(first.deleted > 0 && first.complete === false,
    `…having MOVED first — the budget cannot stop a call that deleted nothing (deleted ${first.deleted}, complete ${first.complete})`);
  ok(typeof first.cursor === "string" && first.cursor.length > 0 && fault.sweepCursorWellFormed(first.cursor),
    `…and it hands back a RESUMABLE token, never null while rows remain (got ${JSON.stringify(first.cursor)})`);

  let token = first.cursor, calls = 1, drained = first.deleted, last = first;
  while (token && calls < 400) {
    last = await fault.sweepHarnessFaults({ maxMs: 1, cursor: token });
    drained += last.deleted;
    token = last.cursor;
    calls++;
  }
  ok(token === null && last.complete === true && last.truncated === false,
    `…and POSTing it back until the token is null TERMINATES with complete:true (${calls} calls, last ${JSON.stringify({ truncated: last.truncated, complete: last.complete })})`);
  ok(calls > 10, `…after genuinely many resumed calls, which is the path no single-row keyspace can reach (${calls})`);
  ok(drained === 250 && (await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 0,
    `…with every one of the 250 rows deleted and none left behind (deleted ${drained})`);
  ok(pauseCount() > pausesBeforeSweep, "…and the deletes were paced too, at the same one published rate");

  /* ── 7f. A REAL KVS CURSOR ROUND-TRIPS. With the keyspace ALL expired the sweep never
   * leaves page 0 (the page shrinks under it), so the token always carries a null cursor —
   * which is exactly why F-674 had to invent a token that can express "the beginning". Put
   * LIVE rows in front of the expired ones and page 0 has nothing to delete: it ADVANCES, and
   * the next token carries the platform's own cursor string. ── */
  await fault.plantHarnessFaults({ n: 250, expired: true });
  await fault.plantHarnessFaults({ n: 120, expired: false });   // overwrites plant:000..119
  ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 250, "(fixture) 120 live rows in front of 130 expired ones");
  const advanced = await fault.sweepHarnessFaults({ maxMs: 1 });
  ok(advanced.truncated === true && typeof advanced.cursor === "string",
    `a sweep whose first page is all-live still stops on budget with a token (got ${JSON.stringify({ truncated: advanced.truncated, reason: advanced.reason })})`);
  const innerCursor = JSON.parse(Buffer.from(advanced.cursor, "base64").toString("utf8")).c;
  ok(typeof innerCursor === "string" && innerCursor.startsWith(fault.HARNESS_FAULT_PLANT_PREFIX),
    `…and the token carries a REAL KVS cursor, not "the beginning" — the multi-page path F-688 exists to reach (got ${JSON.stringify(innerCursor)})`);

  let t2 = advanced.cursor, c2 = 0, last2 = advanced;
  while (t2 && c2 < 400) { last2 = await fault.sweepHarnessFaults({ maxMs: 1, cursor: t2 }); t2 = last2.cursor; c2++; }
  ok(t2 === null && last2.complete === true, `…and that drain terminates too (${c2} resumed calls)`);
  ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 120,
    "…having deleted the 130 expired rows and LEFT every live one — a sweep never cancels a lever somebody is using");

  /* ── 7g. THE CLEAR TAKES THE BALLAST AND NOTHING ELSE. It must delete LIVE planted rows
   * (which the sweep may not), so the only thing keeping it safe is that its prefix is bound
   * to `harness_fault:plant:` and is not a parameter. ── */
  const bystanderArm = await fault.armJiraFault(PATH, 503, 120);
  ok(bystanderArm.ok !== false, "(fixture) a real, LIVE Jira lever armed beside the ballast");
  const bystanderKey = fault.harnessFaultKey(fault.HARNESS_FAULT_JIRA, PATH);

  let ct = null, cc = 0, cleared = 0, lastClear = null;
  do {
    lastClear = await fault.clearPlantedFaults({ maxMs: 1, cursor: ct });
    cleared += lastClear.deleted;
    ct = lastClear.cursor;
    cc++;
  } while (ct && cc < 400);
  ok(ct === null && lastClear.complete === true && cleared === 120,
    `clearPlantedFaults drains the live ballast the sweep will not touch (${cleared} deleted in ${cc} calls, complete ${lastClear.complete})`);
  ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 0, "…the plant sub-prefix is empty");
  ok(lastClear.prefix === fault.HARNESS_FAULT_PLANT_PREFIX && lastClear.prefix === "harness_fault:plant:",
    `…and it reports the ONE prefix it is bound to, which no caller can choose (got ${JSON.stringify(lastClear.prefix)})`);
  ok((await storage.get(bystanderKey)) !== undefined && (await fault.jiraFaultStatus(PATH)) === 503,
    "…while the live Jira lever beside it is untouched — an unconditional delete that could reach it would be a different lever");
  await fault.disarmHarnessFault(fault.HARNESS_FAULT_JIRA, [PATH]);
  await purge();

  /* ── 7h. THE CLEAR CARRIES F-682 AND F-683 TOO, not just their vocabulary. It borrowed the
   * sweep's progress gate and finished-signal; borrowed code with no fixture behind it is a
   * comment. A batch in which EVERY delete is refused must END the call as `deletes-failing`
   * — not arm the progress gate and hand back the page's own cursor forever — and a clear
   * that reached the end of the keyspace with failures is `deletes-failed`, never complete. ── */
  const okDelete688 = kvs.delete;
  {
    await fault.plantHarnessFaults({ n: 20, expired: false });
    kvs.delete = async function refusingDelete(key) {
      if (String(key).startsWith(fault.HARNESS_FAULT_PLANT_PREFIX)) {
        const e = new Error("RATE_LIMIT_EXCEEDED"); e.code = "RATE_LIMIT_EXCEEDED"; throw e;
      }
      return okDelete688.call(this, key);
    };
    let ft = null, fc = 0, lastF = null, landedTotal = 0;
    do {
      lastF = await fault.clearPlantedFaults({ maxMs: 5_000, cursor: ft });
      landedTotal += lastF.deleted;
      ft = lastF.cursor;
      fc++;
      if (lastF.reason === "deletes-failing") break;
    } while (ft && fc < 20);
    ok(fc === 1 && lastF.reason === "deletes-failing",
      `a clear whose whole first batch is refused ENDS as "deletes-failing" rather than spinning on its own cursor (calls ${fc}, reason ${JSON.stringify(lastF.reason)})`);
    ok(lastF.truncated === true && lastF.complete === false && lastF.failed > 0 && landedTotal === 0,
      `…never complete, and honest that nothing landed (got ${JSON.stringify({ truncated: lastF.truncated, complete: lastF.complete, failed: lastF.failed, deleted: landedTotal })})`);
    ok(typeof lastF.cursor === "string" && lastF.cursor.length > 0, "…still carrying the cursor of the page that failed");
    ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 20, "…and every refused row is still there");

    // THE PARTIAL CASE: some land, some do not, and the walk reaches the end of the keyspace.
    const stubborn = new Set([fault.plantedFaultKey(0), fault.plantedFaultKey(1)]);
    kvs.delete = async function partlyRefusingDelete(key) {
      if (stubborn.has(key)) { const e = new Error("RATE_LIMIT_EXCEEDED"); e.code = "RATE_LIMIT_EXCEEDED"; throw e; }
      return okDelete688.call(this, key);
    };
    const partial = await fault.clearPlantedFaults({ maxMs: 20_000 });
    ok(partial.deleted > 0 && partial.failed > 0, `(fixture) some deletes land and some are refused (deleted ${partial.deleted}, failed ${partial.failed})`);
    ok(partial.truncated === true && partial.reason === "deletes-failed" && partial.complete === false,
      `a clear that could not delete what it named is NOT finished (got ${JSON.stringify({ reason: partial.reason, complete: partial.complete })})`);
    ok(typeof partial.cursor === "string" && partial.cursor.length > 0, "…and hands back the page the failures started on");
    kvs.delete = okDelete688;
    await purge();
  }

  globalThis.setTimeout = realTimeout;
}

kvs.set = realSet;
delete process.env.HARNESS_SECRET;

console.log(`\nharness-fault-ttl: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
