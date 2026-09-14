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
  ok((faultCode.match(/if \(!harnessEnabled\(\)\)/g) || []).length === 7,
    "SOURCE: the helpers are NOT exports — the gated-export count is exactly the seven exports, no more");
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

kvs.set = realSet;
delete process.env.HARNESS_SECRET;

console.log(`\nharness-fault-ttl: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
