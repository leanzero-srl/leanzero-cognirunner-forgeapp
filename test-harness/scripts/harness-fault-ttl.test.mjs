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
/* F-690: the drain loop's decision has ONE home — the pure function the live driver obeys.
 * This suite must not carry a second, hand-written copy of it. */
import { decideSweepStep, newDrainState, DELETES_FAILING_BACKOFF_MS, IDENTICAL_ANSWER_LIMIT } from "../lib/sweep-drain.mjs";
/* F-704: the gated-export contract is a shared rule, not a second hand-written copy. */
import { gatedExportViolations, storageTaintedPrivates, exportSources } from "../lib/gated-export-contract.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const SECRET = "harness-secret-664";
process.env.HARNESS_SECRET = SECRET;

const fault = await import("../../src/harness-fault.js");
const PATH = fault.JIRA_FAULT_USER_SEARCH_PATH;
const faultSrc = readFileSync(path.join(here, "../../src/harness-fault.js"), "utf8");
const faultCode = faultSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* F-779 — THE DRAIN CENSUS, DERIVED FROM THE SOURCE AND SHARED BY EVERY RULE BELOW THAT USED
 * TO CARRY A LITERAL COUNT OF DRAINS. `=== 2` tails and `=== 3` delete sites were the F-694
 * defect in a test file: adding `sweepHarnessStashes` turned them red for being correct, and
 * the "fix" is to edit the number rather than to read the rule. A DRAIN is a paged walk that
 * also takes a RESUME TOKEN — that pair is what makes it a thing a caller drains across calls
 * and therefore what makes it owe the shared answer tail. `clearStalePlantedRows` pages but
 * takes no token (its caller owns the answer), so it is correctly not one. */
const topLevelBodies = (() => {
  const marks = [...faultCode.matchAll(/\n(?:export )?(?:const|function) ([A-Za-z_$][\w$]*)/g)];
  return marks.map((m, i) => ({
    name: m[1],
    body: faultCode.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : faultCode.length),
  }));
})();
const drainBodies = topLevelBodies.filter((e) =>
  /for \(let page = 0; page < HARNESS_FAULT_SWEEP_MAX_PAGES/.test(e.body) && /decodeSweepToken\(/.test(e.body));
const DRAINS = drainBodies.length;

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
  /* F-709: TWO reads, and the second one is named and argued. `getFaultRow` is the read home
   * that refuses an expired row and DELETES it on the way out — which is precisely what must
   * not happen to the head of an `expired: true` population that a resumed call is still
   * filling in, and which would lose the deadline the resume went there for. So
   * `plantPopulationDeadline` reads one known key raw, and returns a number, never a row. */
  ok((faultCode.match(/storage\.get\(/g) || []).length === 2
    && /const plantPopulationDeadline = async \(\) => \{\s*\n\s*const head = await storage\.get\(plantedFaultKey\(0\)\)/.test(faultCode),
    `SOURCE: …and exactly TWO storage.gets — the read home, and F-709's named raw read of the population's head (got ${(faultCode.match(/storage\.get\(/g) || []).length})`);
  /* F-694 — THE GATED-EXPORT RULE HAS ONE HOME, AND IT IS THE MODULE'S OWN LIST.
   * This count used to be the literal 9, here and again in async-handler-helpers.test.mjs,
   * so every new gated export turned two suites red and was answered by editing two numbers
   * instead of by reading the rule. Both suites now assert against `HARNESS_GATED_EXPORTS`:
   * the count comes from its LENGTH, the names come from IT, and each named export's source
   * must open with the gate. The helpers are still excluded — they are not exports. */
  ok(Array.isArray(fault.HARNESS_GATED_EXPORTS) && Object.isFrozen(fault.HARNESS_GATED_EXPORTS),
    "F-694: the list of storage-touching exports is exported, and frozen — it is the rule, not a hint");
  ok((faultCode.match(/if \(!harnessEnabled\(\)\)/g) || []).length === fault.HARNESS_GATED_EXPORTS.length,
    `SOURCE: the helpers are NOT exports — the gated-export count is exactly HARNESS_GATED_EXPORTS.length (${fault.HARNESS_GATED_EXPORTS.length}), no more (got ${(faultCode.match(/if \(!harnessEnabled\(\)\)/g) || []).length})`);
  for (const name of fault.HARNESS_GATED_EXPORTS) {
    ok(typeof fault[name] === "function", `F-694: ${name} is listed as gated and really is an export of the module`);
    const body = faultSrc.split(`${name} = async`)[1] || "";
    ok(/^\s*\([^)]*\)\s*=>\s*\{\s*if \(!harnessEnabled\(\)\)/.test(body),
      `F-694: the gate is the FIRST statement of ${name} — before any storage call`);
  }
  /* F-704 — AND THE LIST IS CHECKED AGAINST WHO IS ACTUALLY THERE.
   * The count above compares the gate-line count to the gated list's length: both sides are
   * the gated set, so an export added with NEITHER the gate NOR a list entry left 9 === 9 and
   * the loop above never visited it. The complement is data now too, and the three lists must
   * PARTITION `Object.keys(module)` exactly. The rule has ONE home — lib/gated-export-contract
   * .mjs — asked identically by async-handler-helpers.test.mjs. The hand-written
   * ["keyReadFaultMode","jiraFaultStatus"] denylist that used to live here was a THIRD home of
   * it; it is now `HARNESS_INHERITED_GATE_EXPORTS`, in the module, beside the gate. */
  const contractArgs = {
    names: Object.keys(fault), src: faultSrc,
    gated: fault.HARNESS_GATED_EXPORTS,
    inherited: fault.HARNESS_INHERITED_GATE_EXPORTS,
    ungated: fault.HARNESS_UNGATED_EXPORTS,
  };
  const violations = gatedExportViolations(contractArgs);
  ok(violations.length === 0,
    `F-704: the three lists partition the module's real exports, every gated one opens with the gate, and no other one names storage. (${violations.join(" | ")})`);
  for (const name of fault.HARNESS_INHERITED_GATE_EXPORTS) {
    ok(!fault.HARNESS_GATED_EXPORTS.includes(name) && typeof fault[name] === "function",
      `F-694: ${name} is NOT on the gated list — it touches storage only through readHarnessFault and inherits the gate`);
  }
  // NEGATIVE CONTROL: an export that joined no list is the F-704 defect itself. Without this,
  // a contract that silently returned [] for everything would read exactly like a pass.
  ok(gatedExportViolations({ ...contractArgs, names: [...Object.keys(fault), "purgeHarnessFaults"] })
      .some((m) => /purgeHarnessFaults/.test(m) && /NONE of/.test(m)),
    "F-704 (negative control): an ungated, unlisted export FAILS the contract by name");
  // …and a gated export that does ANYTHING before asking fails too.
  ok(gatedExportViolations({ ...contractArgs,
      src: faultSrc.replace(/(export const disarmHarnessFault = async \(kind, parts\) => \{)/, "$1 const k0 = 1;") })
      .some((m) => /disarmHarnessFault/.test(m) && /first statement/.test(m)),
    "F-704 (negative control): a gated export that acts before asking FAILS the contract");

  /* F-719 — "NAMES NO `storage.`" WAS NEVER "TOUCHES NO STORAGE".
   * The purity rule was a text grep for `storage.` in the export's OWN slice, and this
   * module's storage homes (`setFaultRow`, `getFaultRow`, `settleDeletes`, the raw planted-
   * head read) are module-PRIVATE consts callable by bare name. So the one-liner below — the
   * breaker's exact export — wrote a fault row with no HARNESS_SECRET while passing the
   * census, the gate-line count and both `storage.<op>(` counts. The homes are DERIVED from
   * the source now, transitively, so the next private helper is covered the day it is written. */
  const taintedPrivates = [...storageTaintedPrivates(faultSrc)];
  ok(["setFaultRow", "getFaultRow", "settleDeletes"].every((n) => taintedPrivates.includes(n)),
    `F-719: the private storage homes are DERIVED from the source, never listed (got ${taintedPrivates.join(", ")})`);
  const seedSrc = `${faultSrc}\nexport const seedFaultRow = (k, r) => setFaultRow(k, r, 60);\n`;
  ok(!/\bstorage\./.test(exportSources(seedSrc).get("seedFaultRow") || ""),
    "F-719 (fixture): the breaker's export names no `storage.` at all — which is exactly why the old grep passed it");
  ok(gatedExportViolations({ ...contractArgs,
      names: [...Object.keys(fault), "seedFaultRow"], src: seedSrc,
      ungated: [...fault.HARNESS_UNGATED_EXPORTS, "seedFaultRow"] })
      .some((m) => /seedFaultRow/.test(m) && /setFaultRow/.test(m)),
    "F-719 (negative control): an UNGATED export that reaches KVS through a private storage home FAILS the contract, by both names");
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

  /* F-876 - THE 2 KB CEILING IS A BYTE CEILING, MEASURED IN BYTES.
   * It was compared against `String.length` (UTF-16 code units), so a CJK string of 2048
   * chars measured 2048 against a budget of 2048 BYTES while weighing 6144. Nothing got
   * through even then, because the base64 alphabet below refuses every non-ASCII character
   * anyway - so this asserts the MEASURE directly on the predicate, at the exact boundary,
   * rather than through a door that a second rule was quietly holding shut. */
  const asciiAtCap = "A".repeat(fault.SWEEP_CURSOR_MAX_BYTES);
  ok(fault.sweepCursorWellFormed(asciiAtCap) === true,
    `a token of exactly ${fault.SWEEP_CURSOR_MAX_BYTES} BYTES is admitted (the boundary is inclusive)`);
  ok(fault.sweepCursorWellFormed(`${asciiAtCap}A`) === false, "…and one byte more is refused");
  const cjkUnderCharCount = "一".repeat(fault.SWEEP_CURSOR_MAX_BYTES - 1);
  ok(cjkUnderCharCount.length < fault.SWEEP_CURSOR_MAX_BYTES
    && new TextEncoder().encode(cjkUnderCharCount).length > fault.SWEEP_CURSOR_MAX_BYTES,
    `the multi-byte fixture is under the cap in CHARS (${cjkUnderCharCount.length}) and over it in BYTES (${new TextEncoder().encode(cjkUnderCharCount).length})`);
  ok(fault.sweepCursorWellFormed(cjkUnderCharCount) === false,
    "…and it is refused - the ceiling counts bytes, not UTF-16 code units");
  let cjkCode = null;
  try { fault.decodeSweepCursor(cjkUnderCharCount); } catch (e) { cjkCode = e && e.code; }
  ok(cjkCode === fault.BAD_SWEEP_CURSOR_CODE,
    "…and the door refuses it with the same bad-cursor code, before any KVS call");
  /* The two assertions above hold on BOTH sides of the fix, because the ASCII-only alphabet
   * refuses the CJK fixture on its own. The MEASURE itself therefore has to be pinned at the
   * source, or nothing in this file fails the day the ceiling goes back to counting chars. */
  ok(/utf8ByteLength\(value\)\s*<=\s*SWEEP_CURSOR_MAX_BYTES/.test(faultSrc),
    "F-876.SOURCE: the BYTE ceiling is compared against utf8ByteLength, the one shared measure");
  ok(!/value\.length\s*<=\s*SWEEP_CURSOR_MAX_BYTES/.test(faultSrc),
    "F-876.SOURCE: …and never against String.length, which counts UTF-16 code units");


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
  /* F-690 — THE LOOP UNDER TEST IS THE PRODUCTION ONE. This used to be a hand-written
   * `if (r.reason === "deletes-failing") break;` that existed in no driver anywhere, so the
   * suite proved a contract only it implemented — the same "one rule, two homes" defect one
   * layer up. The decision now comes from `lib/sweep-drain.mjs`'s `decideSweepStep`, the pure
   * function the live driver obeys, and the loop below is the dumb caller that does what it
   * says. A `deletes-failing` answer earns a PAUSED resume (back-off), so what is asserted is
   * that the library ends the CALL that way and that the decision is `resume` with a pause,
   * never a spin. */
  let failToken = null, failCalls = 0, spun = 0, lastFail = null, firstFail = null;
  let drainState = newDrainState(), failDecision = null;
  const failSleeps = [];
  while (failCalls < 50) {
    const r = await fault.sweepHarnessFaults({ maxMs: 5_000, cursor: failToken });
    lastFail = r; failCalls++;
    if (failCalls === 1) firstFail = r;
    spun += r.deleted;
    failDecision = decideSweepStep(r, drainState);
    drainState = failDecision.state;
    if (failDecision.action !== "resume") break;
    failSleeps.push(failDecision.sleepMs);
    failToken = failDecision.cursor;
  }
  ok(firstFail.reason === "deletes-failing",
    `an all-failed batch ENDS the call as "deletes-failing" rather than counting as progress (reason ${JSON.stringify(firstFail.reason)})`);
  ok(failDecision.action === "stop" && /not-converging/.test(String(failDecision.stopReason)),
    `…and the PRODUCTION decision (\`decideSweepStep\`) stops the drain as not-converging rather than spinning (action ${failDecision.action}, calls ${failCalls})`);
  // A store that refuses EVERYTHING answers byte-identically, so the spin detector
  // (`IDENTICAL_ANSWER_LIMIT`) is what fires first — and every resume it did allow was PACED
  // with the published back-off, never fired back-to-back.
  ok(failCalls <= DELETES_FAILING_BACKOFF_MS.length + 1
    && JSON.stringify(failSleeps) === JSON.stringify(DELETES_FAILING_BACKOFF_MS.slice(0, failSleeps.length))
    && failSleeps.length === failCalls - 1 && failSleeps.every((ms) => ms > 0),
    `…after at most the published paced retries, each one actually paused (calls ${failCalls}, sleeps ${JSON.stringify(failSleeps)})`);
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

/* ═════ 7c. F-691 — COMPLETENESS BELONGS TO THE DRAIN, NOT TO THE CALL ═════
 *
 * `failedResume` was a LOCAL: written on the first page whose deletes refused, and read only
 * under `!truncated`. So a budget break on a LATER page dropped it, and the resumed call —
 * which walks to the end with `failed: 0` because the failures are behind it — answered
 * `truncated: false, cursor: null, complete: true` over rows this very drain had condemned
 * and not deleted. `complete` claimed to be "the ONLY definition of a finished sweep" while
 * being a property of ONE CALL.
 *
 * The fixture is the exact sequence the finding names, and it is built so the ordering is
 * DETERMINISTIC rather than raced: three pages of 100 keys, only a handful expired on each,
 * two of page 0's refusing. Call 1 gets `maxMs: 1`, which cannot trip inside page 0 (the
 * F-682 progress gate forbids a break before anything has landed, and page 0's doomed list
 * is one batch) and MUST trip at the top of page 1.
 */
{
  const okDelete = kvs.delete;
  const okQuery = kvs.query;
  const PREFIX = fault.HARNESS_FAULT_KEY_PREFIX;
  /* A clean keyspace: earlier blocks in this file leave rows behind, and a page boundary is
   * only predictable when we know exactly which keys are in it. */
  const purge691 = async () => {
    for (let round = 0; round < 5; round++) {
      const page = await storage.query().where("key", { condition: "BEGINS_WITH", values: [PREFIX] }).limit(1000).getMany();
      const found = (page && page.results) || [];
      if (!found.length) return;
      for (const entry of found) await storage.delete(entry.key);
    }
  };
  await purge691();

  const gone = new Date(Date.now() - 3_600_000).toISOString();
  const live = new Date(Date.now() + 3_600_000).toISOString();
  const key691 = (i) => fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, "f691", String(i).padStart(4, "0"));
  // 300 rows = three pages of HARNESS_FAULT_SWEEP_PAGE_SIZE. Expired ones are rationed so a
  // page is ONE delete batch: the pacing pause is 200 ms and this is an offline suite.
  const doomedOnPage0 = [key691(0), key691(1), key691(2)];
  const doomedLater = [key691(100), key691(200)];
  const condemned = new Set([...doomedOnPage0, ...doomedLater]);
  for (let i = 0; i < 300; i++) {
    const key = key691(i);
    const when = condemned.has(key) ? gone : live;
    await storage.set(key, { count: 1, armedAt: condemned.has(key) ? gone : new Date().toISOString(), until: when });
  }
  // The two that refuse, both on page 0, with one that lands beside them so the batch counts
  // as progress (F-682) and the walk is allowed to go on to page 1 at all.
  const stubborn691 = new Set([key691(0), key691(1)]);
  kvs.delete = async function refuseTwo(key) {
    if (stubborn691.has(key)) { const e = new Error("RATE_LIMIT_EXCEEDED"); e.code = "RATE_LIMIT_EXCEEDED"; throw e; }
    return okDelete.call(this, key);
  };
  /* THE CLOCK, made observable. The mock KVS answers a page in under a millisecond, so a
   * tiny `maxMs` is a RACE, not a fixture — the budget check at the top of page 1 may or may
   * not have anything to measure. A page that takes 50 ms and a 40 ms budget makes the break
   * a certainty, and puts it exactly where the finding needs it: AFTER the failing page. */
  const PAGE_MS = 50;
  kvs.query = function slowQuery(...args) {
    const q = okQuery.apply(this, args);
    const inner = q.getMany.bind(q);
    q.getMany = async () => { await new Promise((r) => setTimeout(r, PAGE_MS)); return inner(); };
    return q;
  };

  // ── CALL 1: page 0 fails two deletes and lands one; the budget breaks at page 1.
  const call1 = await fault.sweepHarnessFaults({ maxMs: 40 });
  ok(call1.failed === 2 && call1.deleted === 1 && call1.truncated === true && call1.reason === "budget",
    `(fixture) call 1 fails two deletes on page 0 and then breaks on BUDGET at a later page (got ${JSON.stringify({ failed: call1.failed, deleted: call1.deleted, reason: call1.reason })})`);
  ok(call1.complete === false && typeof call1.failedResume === "string" && call1.failedResume.length > 0,
    "F-691: the answer carries `failedResume` even though the call ended for another reason — a budget break must not swallow the mess");
  ok(fault.decodeSweepCursor(call1.failedResume) === null,
    "F-691: …and it names PAGE 0 — whose KVS cursor is null, which is exactly why it is reported as a token and not as a bare cursor");
  ok(fault.decodeSweepCursor(call1.cursor) !== null && fault.decodeSweepToken(call1.cursor).unresolved === true,
    "F-691: the resume token points at the LATER page and carries the unresolved failure with it, so the next call inherits it");

  // ── CALL 2: resume, walk to the end, delete everything it finds. `failed` is 0 for THIS
  // call — the old code's entire basis for answering `complete: true`.
  const call2 = await fault.sweepHarnessFaults({ maxMs: 5_000, cursor: call1.cursor });
  ok(call2.failed === 0 && call2.deleted === doomedLater.length,
    `(fixture) call 2 resumes and every delete IT makes lands (deleted ${call2.deleted}, failed ${call2.failed})`);
  ok(call2.complete === false,
    "F-691: the resumed call that finished the keyspace is NOT complete — two rows the drain condemned are still live");
  ok(call2.truncated === true && call2.reason === "deletes-failed",
    `F-691: …it is a STOP, and it says why in the drain's own vocabulary (got ${JSON.stringify({ truncated: call2.truncated, reason: call2.reason })})`);
  ok(call2.failedResume === call1.failedResume && call2.cursor === call1.failedResume,
    "F-691: …and it hands back the EARLIEST unresolved failure, unchanged across two calls, as the place to go next");
  let survivors691 = 0;
  for (const key of stubborn691) if ((await storage.get(key)) !== undefined) survivors691++;
  ok(survivors691 === 2, `F-691: (proof) the two refused rows really are still on the tenant (${survivors691}/2)`);

  // ── CALL 3: post the failure token back, with a store that no longer refuses.
  kvs.delete = okDelete;
  const call3 = await fault.sweepHarnessFaults({ maxMs: 5_000, cursor: call2.cursor });
  ok(call3.deleted === 2 && call3.failed === 0,
    `(fixture) call 3 resumes AT the failure and clears it (deleted ${call3.deleted}, failed ${call3.failed})`);
  ok(call3.complete === true && call3.cursor === null && call3.failedResume === null,
    `F-691: only now is the drain complete — retrying at the failure point clears the carry rather than carrying it forever (got ${JSON.stringify({ complete: call3.complete, cursor: call3.cursor, failedResume: call3.failedResume })})`);

  /* THE TOKEN GRAMMAR ITSELF, executed: `f` is PRESENCE, not truthiness, because the page a
   * delete first failed on may be the beginning of the keyspace, whose cursor is null. */
  ok(fault.decodeSweepToken(fault.encodeSweepCursor("k-9")).unresolved === false,
    "F-691: a token minted without a failure — and every token minted before F-691 — decodes as nothing unresolved");
  const atStart = fault.decodeSweepToken(fault.encodeSweepCursor("k-9", null));
  ok(atStart.unresolved === true && atStart.failedResume === null && atStart.cursor === "k-9",
    "F-691: …while `f: null` is a real unresolved failure at the START of the keyspace, which no bare cursor could ever express");

  /* ONE HOME. The tail that decides `truncated`/`reason`/`cursor`/`complete`/`failedResume`
   * is `sweepAnswerTail`, and BOTH levers call it — the clear used to carry a byte-similar
   * copy, which is how F-683 had to be applied twice. */
  const completeSites = faultCode.match(/complete: [^,\n]+/g) || [];
  ok(/complete: !stopped && !unresolved/.test(faultCode)
    && completeSites.filter((site) => !/tail\.complete/.test(site)).length === 1,
    `F-691.SOURCE: \`complete\` is COMPUTED in exactly one place — the drain-wide definition — and every other mention is a pass-through of it (sites ${JSON.stringify(completeSites)})`);
  /* F-779 — DERIVED, NOT COUNTED. This was `=== 2` and a third drain (`sweepHarnessStashes`)
     turned it red for being correct — the F-694 defect, a magic number in a test file that is
     "fixed" by editing the number rather than by reading the rule. A DRAIN is a function with
     the paged walk, so the expectation is the number of paged walks: every one of them must
     finish its answer through the one tail. */
  ok(DRAINS >= 3, `F-691.SOURCE: the paged drains are still recognisable in the source (found ${DRAINS}: ${drainBodies.map((d) => d.name).join(", ")})`);
  ok(drainBodies.every((d) => /sweepAnswerTail\(/.test(d.body)),
    `F-691.SOURCE: …and EVERY drain finishes its answer through it (${drainBodies.filter((d) => !/sweepAnswerTail\(/.test(d.body)).map((d) => d.name).join(", ") || "all do"})`);

  // Leave the keyspace — and the write spy — as this block found them.
  kvs.delete = okDelete; kvs.query = okQuery;
  await purge691();
  clear();
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
  /* THE FIXTURE'S OWN DRAIN LOOP FOR THE PLANT (F-696): `n` is the POPULATION and a fresh
   * call may only attempt one call's worth, so a fixture that wants 250 rows POSTs the same
   * `n` back with `startIndex: nextIndex` until it is `complete` — which is exactly the
   * contract a live caller follows. Returns the totals across the whole plant. */
  const plantAll = async (n, expired, opts = {}) => {
    let next = 0, planted = 0, failed = 0, calls = 0, last = null;
    while (next < n && calls < 20) {
      last = await fault.plantHarnessFaults({ n, expired, startIndex: next || undefined, ...opts });
      if (last.ok === false) return { ...last, planted, failed, calls };
      planted += last.planted; failed += last.failed; calls++;
      /* F-707: NO FORWARD PROGRESS IS THE STOP, whatever the call placed. A plant whose
       * writes are refused now answers with the FIRST failed index, so a resumed call can
       * place rows and still hand back the index it was given — that is a stuck drain, not
       * a working one, and `planted === 0` no longer describes it. */
      if (last.nextIndex <= next) break;
      next = last.nextIndex;
    }
    return { ...last, planted, failed, calls, nextIndex: next };
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
  ok(fault.HARNESS_GATED_EXPORTS.includes("plantHarnessFaults") && fault.HARNESS_GATED_EXPORTS.includes("clearPlantedFaults"),
    "SOURCE: the two levers F-688 added are ON the gated-export list (F-694) — which is what the count above is taken from");

  /* ── 7b. `n` IS CLAMPED, and the clamp lives with the constant it bounds.
   *
   * F-696 — THE POPULATION CEILING AND THE PER-CALL CEILING ARE DIFFERENT NUMBERS. The
   * keyspace may hold five hundred rows; ONE CALL may only ask for what fits inside the
   * default budget at the measured rate (~90 ms a row), because the old lever advertised
   * five hundred and needed ~45 s of a trigger killed at 25 s. A caller reaches five hundred
   * the way it drains the sweep: by resuming. ── */
  ok(fault.HARNESS_FAULT_PLANT_MAX === 500, "the POPULATION ceiling is five hundred rows — five pages of the sweep's page size");
  ok(fault.HARNESS_FAULT_PLANT_CALL_MAX === 150
    && fault.HARNESS_FAULT_PLANT_CALL_MAX * fault.HARNESS_FAULT_PLANT_MS_PER_ROW <= fault.HARNESS_FAULT_SWEEP_DEFAULT_MS,
    `…while ONE CALL's ceiling (${fault.HARNESS_FAULT_PLANT_CALL_MAX}) fits inside the default ${fault.HARNESS_FAULT_SWEEP_DEFAULT_MS} ms budget at the measured ${fault.HARNESS_FAULT_PLANT_MS_PER_ROW} ms a row`);
  ok(fault.plantCountClamped(0) === 1 && fault.plantCountClamped(-40) === 1, "zero and negative clamp UP to one");
  ok(fault.plantCountClamped(10_000) === 150 && fault.plantCountClamped(151) === 150,
    "a FRESH call above the per-call ceiling IS the per-call ceiling");
  ok(fault.plantCountClamped(10_000, 150) === 500 && fault.plantCountClamped(501, 150) === 500,
    "…and a RESUMED call may name the whole population, up to five hundred");
  ok(fault.plantMaxForCall(undefined) === 150 && fault.plantMaxForCall(0) === 150 && fault.plantMaxForCall(1) === 500,
    "…which is ONE rule (`plantMaxForCall`), so the door advertises exactly what the lever enforces");
  ok(fault.plantStartIndexClamped(undefined) === 0 && fault.plantStartIndexClamped("banana") === 0 && fault.plantStartIndexClamped(-9) === 0,
    "a missing or junk `startIndex` is a FRESH plant, never a mystery offset");
  ok(fault.plantStartIndexClamped(10_000) === 499, "…and it can never point past the last index the population may hold");
  ok(fault.plantCountClamped(undefined) === 1 && fault.plantCountClamped("banana") === 1 && fault.plantCountClamped(NaN) === 1,
    "a missing or junk `n` is ONE — the smallest population, never the largest");
  ok(fault.plantCountClamped(7.9) === 7, "…and a fraction floors rather than rounding up");
  const overCap = await fault.plantHarnessFaults({ n: 10_000, expired: true });
  ok(overCap.planted === 150 && overCap.nextIndex === 150,
    `…and the clamp is enforced END TO END, not just in the helper (asked 10000, planted ${overCap.planted}, nextIndex ${overCap.nextIndex})`);
  /* F-710 — AND IT IS VISIBLE. The clamped call used to rewrite `n` to 150 and answer
   * `complete: true`, so a caller looping "until complete" stopped at one call's worth
   * believing it had planted the population it asked for. */
  ok(overCap.n === fault.HARNESS_FAULT_PLANT_MAX,
    `F-710: the answer ECHOES the population it was asked for (clamped to the keyspace ceiling), never the per-call clamp (got n=${overCap.n})`);
  ok(overCap.truncated === true && overCap.reason === "call-max" && overCap.complete === false,
    `F-710: …and a call that stopped at its own ceiling is TRUNCATED, with a reason of its own (got ${JSON.stringify({ truncated: overCap.truncated, reason: overCap.reason, complete: overCap.complete })})`);
  const overCapResumed = await fault.plantHarnessFaults({ n: 10_000, expired: true, startIndex: overCap.nextIndex });
  ok(overCapResumed.n === 500 && overCapResumed.planted === 350 && overCapResumed.nextIndex === 500 && overCapResumed.complete === true,
    `…and the resumed call finishes the population and no more (planted ${overCapResumed.planted}, nextIndex ${overCapResumed.nextIndex})`);
  ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 500,
    "…exactly five hundred rows reached the store — the keys are index-derived, so resuming cannot double-count");
  await purge();

  /* ── 7c. THE ROW SHAPE: the SECONDS ttl option, and `until` on both sides of now ── */
  clear();
  const live = await fault.plantHarnessFaults({ n: 2, expired: false });
  const lw = lastWrite();
  ok(JSON.stringify(lw.options) === JSON.stringify({ ttl: { value: fault.plantTtlSeconds(2), unit: "SECONDS" } }),
    `a planted row passes exactly { ttl: { value: <the window>, unit: "SECONDS" } } — forgotten ballast leaves on its own (got ${JSON.stringify(lw.options)})`);
  ok(lw.value.count === 1 && lw.value.plantedBy === "harness" && typeof lw.value.armedAt === "string",
    `…with the documented row shape (got ${JSON.stringify(lw.value)})`);
  ok(Date.parse(lw.value.until) - Date.parse(lw.value.armedAt) === fault.plantTtlSeconds(2) * 1000,
    `…and a live row's \`until\` is exactly armedAt + the window this plant reported (got until=${lw.value.until} armedAt=${lw.value.armedAt})`);
  ok(fault.faultRowExpired(lw.value) === false && live.expired === false, "…so the sweep must LIST it and leave it alone");

  clear();
  const dead = await fault.plantHarnessFaults({ n: 2, expired: true });
  const dw = lastWrite();
  ok(JSON.stringify(dw.options) === JSON.stringify({ ttl: { value: fault.plantTtlSeconds(2), unit: "SECONDS" } }),
    "an expired row passes the SAME SECONDS shape — the platform TTL is not what makes it expired");
  ok(Date.parse(dw.value.until) < Date.now(), `…but its \`until\` is in the PAST (got ${dw.value.until})`);
  ok(fault.faultRowExpired(dw.value) === true && dead.expired === true,
    "…which is the only shape the sweep will actually delete");

  /* F-697/F-709 — THE WINDOW COVERS THE WHOLE PLANT, AND THE WHOLE PLANT IS MORE THAN ITS
   * WRITES. F-697: a flat sixty seconds is shorter than the plant that writes it, so rows the
   * sweep "must list and leave alone" had already crossed their own `until`. F-709: modelling
   * that as `rows × 90 ms` was still wrong, because a population above the per-call ceiling
   * CANNOT be planted in one call — the resume loop is mandatory, and between two calls sit a
   * caller round trip and a cold start the write rate knows nothing about. A 500-row window
   * was 105 s against ≥4 calls of a 15 s budget: the head expired before the tail was written,
   * which is the manufactured evidence F-697 existed to kill, reintroduced by the resume that
   * shipped with it.
   *
   * THIS SUITE NO LONGER SHARES THE MODEL IT IS CHECKING. The old assertion re-derived
   * `rows × 90 ms` from the same constant the lever used, so it could only ever agree with it;
   * what is asserted now is the WALL TIME of the drain the lever forces. */
  ok(fault.plantTtlSeconds(0) === fault.HARNESS_FAULT_PLANT_TTL_SECONDS,
    "a plant of nothing keeps the sixty-second floor");
  ok(fault.HARNESS_FAULT_PLANT_COLD_START_MS === 5_000,
    "F-709: a resumed call costs a round trip and a cold start besides its writes, and that cost is a named constant");
  for (const rows of [1, 2, 150, 151, 400, 500]) {
    const calls = Math.ceil(rows / fault.HARNESS_FAULT_PLANT_CALL_MAX);
    const wallMs = calls * (fault.HARNESS_FAULT_SWEEP_DEFAULT_MS + fault.HARNESS_FAULT_PLANT_COLD_START_MS);
    ok(fault.plantTtlSeconds(rows) * 1000 >= wallMs + fault.HARNESS_FAULT_PLANT_TTL_SECONDS * 1000,
      `F-709: a ${rows}-row plant's window (${fault.plantTtlSeconds(rows)} s) covers the ${calls} call(s) the resume loop forces — ${Math.round(wallMs / 1000)} s of budget and cold starts — PLUS a full minute after the last row lands`);
    ok(fault.plantTtlSeconds(rows) * 1000 >= rows * fault.HARNESS_FAULT_PLANT_MS_PER_ROW + fault.HARNESS_FAULT_PLANT_TTL_SECONDS * 1000,
      `…and it still covers the old write-time model too (${rows} rows at ${fault.HARNESS_FAULT_PLANT_MS_PER_ROW} ms)`);
  }
  ok(fault.plantTtlSeconds(500) > 105,
    `F-709: the 500-row window is no longer the 105 s that was SHORTER than the four calls it takes (got ${fault.plantTtlSeconds(500)} s)`);
  ok(fault.plantTtlSeconds(150) === fault.plantTtlSeconds(1) && fault.plantTtlSeconds(151) > fault.plantTtlSeconds(150),
    `F-709: the window steps with the CALL COUNT, which is what the resume loop actually costs (150 → ${fault.plantTtlSeconds(150)} s, 151 → ${fault.plantTtlSeconds(151)} s)`);
  ok(fault.plantTtlSeconds(10_000) <= fault.HARNESS_FAULT_TTL_SECONDS,
    "…while the ten-minute family ceiling still binds — the number reported is the number written");
  ok(live.ttlSeconds === fault.plantTtlSeconds(2) && lw.options.ttl.value === live.ttlSeconds,
    `…and the lever REPORTS the window it actually wrote (got ${live.ttlSeconds})`);
  const big = await fault.plantHarnessFaults({ n: 150, expired: false });
  const bigWrite = lastWrite();
  ok(big.ttlSeconds === fault.plantTtlSeconds(150) && big.ttlSeconds > fault.HARNESS_FAULT_PLANT_TTL_SECONDS
    && bigWrite.options.ttl.value === big.ttlSeconds,
    `…end to end: a 150-row plant writes the SCALED window, platform TTL included (got ${big.ttlSeconds} s)`);
  await purge();

  /* ── 7d. THE ROWS ARE INERT. Not a source claim: 250 of them are in the store while every
   * reader in the module is called. `harnessFaultKey` puts the KIND in the second segment and
   * each consumer exact-matches its own constant, so `plant` matches nothing. ── */
  const inert = await plantAll(250, true);
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
  await plantAll(250, true);
  /* F-708 — THE FIXTURE CANNOT BE BUILT BY RE-PLANTING SMALLER ANY MORE, and that is the cut:
   * a fresh plant of 120 over a 250-row population now REMOVES `plant:120..249` instead of
   * leaving it alive under an answer that says `n: 120`. The live head is therefore written
   * by one call of the SAME population (150 rows, one call's worth), which overwrites
   * `plant:000..149` in place and leaves the expired tail exactly where it is. */
  const liveHead = await fault.plantHarnessFaults({ n: 250, expired: false, maxMs: 20_000 });
  ok(liveHead.planted === fault.HARNESS_FAULT_PLANT_CALL_MAX && liveHead.cleared === 0,
    `(fixture) one call's worth of LIVE rows written over the head of the expired population, clearing nothing (planted ${liveHead.planted}, cleared ${liveHead.cleared})`);
  ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 250, "(fixture) 150 live rows in front of 100 expired ones");
  const advanced = await fault.sweepHarnessFaults({ maxMs: 1 });
  ok(advanced.truncated === true && typeof advanced.cursor === "string",
    `a sweep whose first page is all-live still stops on budget with a token (got ${JSON.stringify({ truncated: advanced.truncated, reason: advanced.reason })})`);
  const innerCursor = JSON.parse(Buffer.from(advanced.cursor, "base64").toString("utf8")).c;
  ok(typeof innerCursor === "string" && innerCursor.startsWith(fault.HARNESS_FAULT_PLANT_PREFIX),
    `…and the token carries a REAL KVS cursor, not "the beginning" — the multi-page path F-688 exists to reach (got ${JSON.stringify(innerCursor)})`);

  let t2 = advanced.cursor, c2 = 0, last2 = advanced;
  while (t2 && c2 < 400) { last2 = await fault.sweepHarnessFaults({ maxMs: 1, cursor: t2 }); t2 = last2.cursor; c2++; }
  ok(t2 === null && last2.complete === true, `…and that drain terminates too (${c2} resumed calls)`);
  ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === fault.HARNESS_FAULT_PLANT_CALL_MAX,
    "…having deleted the 100 expired rows and LEFT every live one — a sweep never cancels a lever somebody is using");

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
  ok(ct === null && lastClear.complete === true && cleared === fault.HARNESS_FAULT_PLANT_CALL_MAX,
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
    await plantAll(20, false);
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

  /* ── 7i. F-696 — THE PLANT HAS THE SWEEP'S SHAPE: A BUDGET, A PARTIAL ANSWER, A RESUME.
   *
   * MEASURED LIVE: 200 rows in 17–18 s. The documented 500 was therefore ~45 s of paced
   * writing against a web trigger killed at 55 s (F-680 corrected the 25 s stated here), and because the answer was assembled only
   * after the LAST write, a plant that timed out reported NOTHING — not `planted`, not
   * `failed`, not `keys` — having already written an unknown number of rows under keys a
   * re-POST silently overwrites. The sibling written in the same commit (`clearPlantedFaults`)
   * had `maxMs`, a budget checked before every batch and a resume cursor; the plant had none.
   *
   * The pacing is free in this suite (the `setTimeout` shim above), so the elapsed time that
   * IS the finding has to come from somewhere real: WRITE LATENCY is injected on the plant
   * keyspace, awaited on the REAL timer, which makes the budget break deterministic rather
   * than a race with the machine. ── */
  await purge();
  {
    const spyingSet = kvs.set;
    let writeLatencyMs = 0;
    kvs.set = async function latentSet(key, value, options) {
      if (writeLatencyMs > 0 && String(key).startsWith(fault.HARNESS_FAULT_PLANT_PREFIX)) {
        await new Promise((r) => realTimeout(r, writeLatencyMs));
      }
      return spyingSet.call(this, key, value, options);
    };
    writeLatencyMs = 12;

    const N = 60;
    clear();
    const cut = await fault.plantHarnessFaults({ n: N, expired: false, maxMs: 60 });
    ok(cut.ok === true && cut.truncated === true && cut.reason === "budget",
      `a plant that runs out of time RETURNS, truncated with reason "budget" (got ${JSON.stringify({ ok: cut.ok, truncated: cut.truncated, reason: cut.reason })})`);
    ok(cut.planted > 0 && cut.planted < N && cut.failed === 0 && cut.complete === false,
      `…with the REAL counters of what it placed, which the old all-or-nothing answer threw away (planted ${cut.planted}/${N}, complete ${cut.complete})`);
    ok(cut.nextIndex === cut.planted && cut.nextIndex > 0 && cut.nextIndex < N,
      `…and a \`nextIndex\` that names exactly where to carry on (got ${cut.nextIndex})`);
    ok(cut.startIndex === 0 && cut.keys.length === cut.planted,
      `…naming the keys it actually wrote and the index it actually started at (keys ${cut.keys.length}, startIndex ${cut.startIndex})`);
    ok((await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === cut.planted,
      "…and the store holds precisely what the partial answer claims — the count is never unknown again");

    /* PROGRESS PER CALL IS GUARANTEED (the sweep's F-682 rule, same words): a `maxMs` so small
     * that the first check trips must still place a batch, or a resume loop never converges. */
    const tiny = await fault.plantHarnessFaults({ n: N, expired: false, startIndex: cut.nextIndex, maxMs: 1 });
    ok(tiny.planted > 0 && tiny.nextIndex > cut.nextIndex,
      `a resumed call with an impossible budget still MOVES — the budget may only stop a call that wrote something (planted ${tiny.planted}, ${cut.nextIndex} → ${tiny.nextIndex})`);

    // RESUME TO THE END: the same `n`, the returned `startIndex`, until `complete`.
    let next = tiny.nextIndex, calls = 2, placed = cut.planted + tiny.planted, last = tiny;
    while (next < N && calls < 60) {
      last = await fault.plantHarnessFaults({ n: N, expired: false, startIndex: next, maxMs: 60 });
      placed += last.planted;
      next = last.nextIndex;
      calls++;
    }
    ok(last.complete === true && last.truncated === false && next === N,
      `…and POSTing the same \`n\` back with \`startIndex: nextIndex\` TERMINATES with complete:true (${calls} calls, nextIndex ${next})`);
    ok(placed === N && (await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === N,
      `…having placed EXACTLY ${N} rows — index-derived keys, so a resumed plant is one population and not two (placed ${placed})`);
    ok(calls > 2, `…across genuinely several calls, which is the path the 25 s trigger forces (${calls})`);

    /* F-697 + F-709 — `armedAt` IS PER BATCH, THE DEADLINE IS THE POPULATION'S.
     *
     * F-697: one `armedAt` computed before the loop dated every row from the START of a plant
     * that takes tens of seconds, so a row's recorded birth had nothing to do with when it was
     * written. Each batch is stamped when it is written, and that is still asserted below.
     *
     * F-709 turned the OTHER stamp the other way. `until` used to be re-derived from each
     * call's own clock, which sounds like the same fix and is the opposite of one: the rows of
     * call 4 then outlived the rows of call 1 by the whole wall time of the plant, and the
     * head — whose window was computed before three round trips it knew nothing about — could
     * be gone before the tail existed. A population is ONE thing that a sweep walks in one
     * pass, so it gets ONE deadline, minted by the first batch of the first call and carried
     * on `plant:000` for every call after it. What is checked here is both halves at once:
     * `armedAt` walks forward, `until` does not move at all, and the LAST row still has a full
     * minute after it. */
    const plantWrites = writes.filter((w) => String(w.key).startsWith(fault.HARNESS_FAULT_PLANT_PREFIX));
    const plantUntils = plantWrites.map((w) => Date.parse(w.value.until));
    const plantArmed = plantWrites.map((w) => Date.parse(w.value.armedAt));
    ok(plantUntils.length === N && plantUntils.every((t) => Number.isFinite(t)),
      `(fixture) every one of the ${N} writes was recorded with a parseable deadline (got ${plantUntils.length})`);
    ok(plantArmed[plantArmed.length - 1] > plantArmed[0],
      `F-697: the LAST row is dated later than the FIRST — one \`armedAt\` for the whole plant is exactly F-697 (Δ ${plantArmed[plantArmed.length - 1] - plantArmed[0]} ms)`);
    ok(plantArmed.every((t, i) => i === 0 || t >= plantArmed[i - 1]),
      "…and it never goes BACKWARDS: each batch is stamped at write time, in order");
    const armedStamps = [...new Set(plantArmed)];
    ok(armedStamps.length > 1 && armedStamps.length <= Math.ceil(N / fault.KVS_DELETE_BATCH) + calls,
      `…at most one \`armedAt\` per BATCH of ${fault.KVS_DELETE_BATCH}, never one per plant and never one per row (${armedStamps.length} distinct stamps over ${N} rows in ${calls} calls)`);
    const deadlines = [...new Set(plantUntils)];
    ok(deadlines.length === 1,
      `F-709: …while the DEADLINE is the population's — ONE value across all ${calls} calls, not one per call (${deadlines.length} distinct)`);
    ok(last.ttlSeconds === fault.plantTtlSeconds(N) && deadlines[0] === plantArmed[0] + fault.plantTtlSeconds(N) * 1000,
      `F-709: …minted by the FIRST batch of the first call as its own stamp plus the reported window (${last.ttlSeconds} s)`);
    ok(deadlines[0] - plantArmed[plantArmed.length - 1] >= fault.HARNESS_FAULT_PLANT_TTL_SECONDS * 1000,
      `F-709: …and the LAST row written still has a full minute of life after it, which is the promise a per-call deadline could not keep (${Math.round((deadlines[0] - plantArmed[plantArmed.length - 1]) / 1000)} s)`);

    /* THE RESUMED CALL IS WHERE THE DEADLINE USED TO DRIFT, so it is asserted directly: the
     * head row's `until` is what a resumed call writes, whatever its own clock says. */
    const headRow = await storage.get(fault.plantedFaultKey(0));
    const tailRow = await storage.get(fault.plantedFaultKey(N - 1));
    ok(headRow && tailRow && headRow.until === tailRow.until,
      `F-709: the head and the tail of a multi-call population carry the IDENTICAL deadline (head ${headRow && headRow.until}, tail ${tailRow && tailRow.until})`);
    ok(tailRow.armedAt > headRow.armedAt,
      "F-709: …while their `armedAt` still says which was written first — two stamps, two jobs");

    /* WITHIN ONE CALL TOO. `armedAt` must walk batch by batch even when no resume boundary
     * forces it — a stamp that only moves ACROSS calls is still one stamp for the 150 rows a
     * single call may write. */
    await purge();
    clear();
    const oneCall = await fault.plantHarnessFaults({ n: N, expired: false, maxMs: 20_000 });
    const oneCallWrites = writes.filter((w) => String(w.key).startsWith(fault.HARNESS_FAULT_PLANT_PREFIX));
    const oneCallArmed = [...new Set(oneCallWrites.map((w) => w.value.armedAt))];
    const oneCallUntils = [...new Set(oneCallWrites.map((w) => w.value.until))];
    ok(oneCall.complete === true && oneCall.planted === N && oneCallWrites.length === N,
      `(fixture) the whole ${N}-row population planted in ONE call (planted ${oneCall.planted})`);
    ok(oneCallArmed.length > 1,
      `F-697: even inside ONE call the rows are not dated together — ${oneCallArmed.length} distinct \`armedAt\` over ${N} rows, which one stamp per plant would make exactly 1`);
    ok(oneCallArmed.length >= Math.floor(N / fault.KVS_DELETE_BATCH / 2),
      `…roughly one per batch of ${fault.KVS_DELETE_BATCH}, not a handful (${oneCallArmed.length})`);
    ok(oneCallWrites.every((w, i) => i === 0 || Date.parse(w.value.armedAt) >= Date.parse(oneCallWrites[i - 1].value.armedAt)),
      "…in write order, never backwards");
    ok(oneCallUntils.length === 1,
      `F-709: …and one call's population shares one deadline too — the rule is the population's, not the call's (${oneCallUntils.length} distinct)`);

    /* AND THE EXPIRED SHAPE IS STILL EXPIRED, per batch, for the sweep this ballast exists
     * for: back-dating is relative to each batch's own write time, not to one clock read. */
    await purge();
    clear();
    const deadPaced = await plantAll(30, true, { maxMs: 60 });
    const deadWrites = writes.filter((w) => String(w.key).startsWith(fault.HARNESS_FAULT_PLANT_PREFIX));
    ok(deadPaced.planted === 30 && deadWrites.every((w) => fault.faultRowExpired(w.value) === true),
      `every row of a paced \`expired: true\` plant is expired on ARRIVAL (planted ${deadPaced.planted})`);
    ok(new Set(deadWrites.map((w) => w.value.until)).size === 1
      && new Set(deadWrites.map((w) => w.value.armedAt)).size > 1,
      "F-709: …sharing the population's ONE back-dated deadline while still being dated per batch — the head of an expired population is read RAW, so a resumed call can carry its deadline without the one read deleting it");

    writeLatencyMs = 0;
    kvs.set = spyingSet;
    await purge();
  }

  /* ═════ 7h. F-706 — THE FAILING-DELETE HALF OF THE CONTRACT GETS A DOOR ═════
   *
   * F-682 (`deletes-failing`), F-683 (`deletes-failed` + `failedResume`), F-690 (the drain's
   * back-off) and F-691 (the unresolved failure riding the token) are all about what the
   * sweep does when a KVS delete REFUSES — and nothing a tester can do on a live tenant makes
   * one refuse (plant-sweep-live 2026-09-14: `failed: 0`, zero RATE_LIMIT, throughout). So
   * `armDeleteFault` is the seventh member of the family, and what is asserted here is the
   * whole of it: the gate, the EXACT prefix, the mode allow-list, both clamps, the counted
   * decrement through the one consumption home, the `until` bound, and a real drain that goes
   * `deletes-failing` → `deletes-failed` (the token dropping `f` because the retry lands on
   * the failure) → `complete: true`. With a stash as the negative control, because a drain
   * that fails the same way with the lever REMOVED proves nothing about the lever. ── */
  {
    await purge();
    const PLANT = fault.HARNESS_FAULT_PLANT_PREFIX;
    const leverKey = fault.harnessFaultKey(fault.HARNESS_FAULT_DELETE, PLANT);
    const readLever = () => fault.readHarnessFault(fault.HARNESS_FAULT_DELETE, [PLANT]);

    /* ── GATED, like the other six, on its FIRST statement — production arms nothing. ── */
    delete process.env.HARNESS_SECRET;
    const offArm = await fault.armDeleteFault({ prefix: PLANT, mode: "refuse", count: 3, ttlSeconds: 60 });
    ok(offArm.ok === false && offArm.reason === "harness-off",
      `F-706: armDeleteFault refuses harness-off with no HARNESS_SECRET (got ${JSON.stringify(offArm)})`);
    ok((await storage.get(leverKey)) === undefined, "…and the refused arm wrote NOTHING to the keyspace");
    process.env.HARNESS_SECRET = SECRET;
    ok(fault.HARNESS_GATED_EXPORTS.includes("armDeleteFault"),
      "SOURCE: armDeleteFault is ON the gated-export list (F-694/F-704), which is where the gate-line count comes from");

    /* ── THE PREFIX IS EXACT, AND IT IS THE PLANT'S. A lever that can fail an arbitrary
     * delete can strand app data; this one can only refuse to remove inert ballast. ── */
    for (const bad of ["harness_fault:", "", "doc_repo:", `${PLANT}x`, undefined]) {
      const r = await fault.armDeleteFault({ prefix: bad, mode: "refuse", count: 2, ttlSeconds: 30 });
      ok(r.ok === false && r.reason === "bad-prefix" && r.prefix === PLANT,
        `F-706: prefix ${JSON.stringify(bad)} is refused — only ${PLANT}, by equality (got ${JSON.stringify(r)})`);
    }
    ok((await storage.get(leverKey)) === undefined, "…and none of those refusals wrote a row either");
    const badMode = await fault.armDeleteFault({ prefix: PLANT, mode: "explode", count: 2, ttlSeconds: 30 });
    ok(badMode.ok === false && badMode.reason === "bad-mode" && badMode.modes.join(",") === "refuse,throttle",
      `F-706: the mode allow-list is the lever's, and it is the two modes (got ${JSON.stringify(badMode)})`);

    /* ── BOTH CLAMPS LIVE WITH THE LEVER, never at the web trigger. ── */
    const clamped = await fault.armDeleteFault({ prefix: PLANT, mode: "refuse", count: 10_000, ttlSeconds: 9_999 });
    /* F-722 — the count ceiling is DERIVED from the drain's own arithmetic, not hand-set.
     * A faulted sweep spends KVS_DELETE_BATCH units per call and answers byte-identically,
     * so the drain's spin detector stops at IDENTICAL_ANSWER_LIMIT * KVS_DELETE_BATCH units;
     * an arm may carry one FEWER than that so the last faulted call leaves a unit for the
     * call that converges. The old cap, 50, was about five times what any drain tolerates. */
    ok(fault.DELETE_FAULT_DRAINABLE_MAX === fault.DRAIN_IDENTICAL_ANSWER_LIMIT * fault.KVS_DELETE_BATCH - 1,
      `F-722: the ceiling is computed from the two constants, never typed (got ${fault.DELETE_FAULT_DRAINABLE_MAX})`);
    ok(fault.DRAIN_IDENTICAL_ANSWER_LIMIT === IDENTICAL_ANSWER_LIMIT,
      `F-722: …and src's spin limit is the SAME number lib/sweep-drain.mjs stops on — the lib still hard-codes its own IDENTICAL_ANSWER_LIMIT (src may not import from test-harness), so this is what keeps the two homes equal (src ${fault.DRAIN_IDENTICAL_ANSWER_LIMIT}, lib ${IDENTICAL_ANSWER_LIMIT})`);
    ok(clamped.count === fault.DELETE_FAULT_DRAINABLE_MAX && fault.DELETE_FAULT_DRAINABLE_MAX === 8,
      `F-722: count clamps to the drainable max, 8 (got ${clamped.count})`);
    ok(fault.HARNESS_DELETE_FAULT_MAX_COUNT === undefined,
      "F-722: …and the old hand-set 50 is GONE — one ceiling, not two that disagree");
    ok(clamped.count < fault.DRAIN_IDENTICAL_ANSWER_LIMIT * fault.KVS_DELETE_BATCH,
      `F-722: …strictly under the spin detector's budget, so a drain can still converge (${clamped.count} < ${fault.DRAIN_IDENTICAL_ANSWER_LIMIT * fault.KVS_DELETE_BATCH})`);
    ok(clamped.ttlSeconds === fault.HARNESS_DELETE_FAULT_MAX_TTL_SECONDS && fault.HARNESS_DELETE_FAULT_MAX_TTL_SECONDS === 120,
      `F-706: ttlSeconds clamps to 120 (got ${clamped.ttlSeconds})`);
    ok(secondsUntil(clamped.until) <= 120 && secondsUntil(clamped.until) > 100,
      `…and the row carries its own \`until\`, like every lever in this family (got ${clamped.until})`);
    const floored = await fault.armDeleteFault({ prefix: PLANT, mode: "throttle", count: 0, ttlSeconds: -5 });
    ok(floored.count === 1 && floored.ttlSeconds === 1 && floored.mode === "throttle",
      `F-706: zero and negative clamp UP to the floor of one, never to zero — a lever armed for nothing is a lever that silently does nothing (got ${JSON.stringify(floored)})`);
    await fault.disarmHarnessFault(fault.HARNESS_FAULT_DELETE, [PLANT]);

    /* ── A ROW PAST ITS `until` IS NOT ARMED. Same read-time bound as F-664: the sweep reads
     * the lever THROUGH `readHarnessFault`, so an expired lever is absent and deleted. ── */
    await storage.set(leverKey, { mode: "refuse", count: 9, armedAt: new Date(Date.now() - 300_000).toISOString(), until: new Date(Date.now() - 1_000).toISOString() });
    const expiredLever = await readLever();
    ok(expiredLever.value === null && expiredLever.expired === true,
      `F-706: a delete fault past its \`until\` reads as ABSENT (got ${JSON.stringify(expiredLever)})`);
    await storage.set(leverKey, { mode: "refuse", count: 9, armedAt: new Date(Date.now() - 300_000).toISOString(), until: new Date(Date.now() - 1_000).toISOString() });
    await plantAll(4, true);
    const afterExpiry = await fault.sweepHarnessFaults({ maxMs: 5_000 });
    ok(afterExpiry.failed === 0 && afterExpiry.complete === true,
      `F-706: …so a sweep run under an EXPIRED lever deletes for real and completes (got failed ${afterExpiry.failed}, complete ${afterExpiry.complete})`);
    ok((await countPrefix(PLANT)) === 0, "…and the ballast is gone");

    /* ── THE COUNT IS SPENT THROUGH THE EXISTING CONSUMPTION HOME, one unit per faulted
     * delete, and `harnessFaultArmed` carries the window through rather than re-arming it. ── */
    await purge();
    await plantAll(4, true);
    const armed2 = await fault.armDeleteFault({ prefix: PLANT, mode: "refuse", count: 2, ttlSeconds: 60 });
    const untilAtArm = armed2.until;
    ok((await readLever()).value.count === 2, "(fixture) the lever says two");
    const partialFault = await fault.sweepHarnessFaults({ maxMs: 5_000 });
    ok(partialFault.failed === 2 && partialFault.deleted === 2,
      `F-706: exactly TWO deletes were refused — the count, not the batch (failed ${partialFault.failed}, deleted ${partialFault.deleted})`);
    ok((await readLever()) === null || (await readLever()).value === null,
      "…and a lever spent to zero removes itself, like every counted lever (F-517)");
    ok(untilAtArm === armed2.until, "…the decrement never re-armed the window (F-667): same `until` throughout");
    await purge();

    /* ── THE MODE IS THE CODE, and `throttle` is the real one F-677/F-682 were written
     * about, so a drain can be driven down the exact path the pacing exists for. ── */
    ok(fault.deleteFaultCode("throttle") === "RATE_LIMIT_EXCEEDED" && fault.deleteFaultCode("throttle") === fault.DELETE_FAULT_THROTTLE_CODE,
      "F-706: `throttle` rejects with the platform's own RATE_LIMIT_EXCEEDED");
    ok(fault.deleteFaultCode("refuse") === "HARNESS_DELETE_FAULT" && fault.deleteFaultCode("refuse") === fault.HARNESS_DELETE_FAULT_CODE,
      "F-706: `refuse` rejects with a code NO platform emits — a planted failure is never mistaken for a real one");

    /* ── THE DRAIN. Five expired rows, a three-deep `refuse`: batch 0 lands NOTHING, which is
     * F-682's `deletes-failing`; the count is then spent, so the retry deletes for real and
     * the drain converges. The token's `f` is the thing being watched. ── */
    for (const mode of ["refuse", "throttle"]) {
      await purge();
      await plantAll(5, true);
      await fault.armDeleteFault({ prefix: PLANT, mode, count: fault.KVS_DELETE_BATCH, ttlSeconds: 60 });

      const call1 = await fault.sweepHarnessFaults({ maxMs: 5_000 });
      ok(call1.ok === true && call1.deleted === 0 && call1.failed === fault.KVS_DELETE_BATCH,
        `F-706/${mode}: a whole batch refused — deleted 0, failed ${call1.failed}`);
      ok(call1.reason === "deletes-failing" && call1.truncated === true && call1.complete === false,
        `F-682 through the live lever: the answer says outright that this is NOT converging (got ${JSON.stringify({ reason: call1.reason, complete: call1.complete })})`);
      ok(typeof call1.failedResume === "string",
        "F-691 through the live lever: the unresolved failure is reported as its own TOKEN field, so a caller never reconstructs where the mess was");
      /* `f` is deliberately ABSENT from THIS token, and that is `sweepAnswerTail`'s rule, not
       * an omission: the break is mid-page with the page's OWN cursor, so the answer's cursor
       * IS the failing page and `carry` is false — "resuming AT the failure IS the retry".
       * `f` rides the token only when the answer resumes somewhere AHEAD of the failure, which
       * is the multi-page budget break section 7c already drives. */
      ok(typeof call1.cursor === "string"
        && !("f" in JSON.parse(Buffer.from(call1.cursor, "base64").toString("utf8")))
        && call1.cursor === call1.failedResume,
        `F-691: the resume token IS the failing page, so it carries no separate \`f\` (cursor ${call1.cursor}, failedResume ${call1.failedResume})`);
      ok((await countPrefix(PLANT)) === 5, "…and not one planted row was actually deleted");

      // The lever is spent. The retry lands on the failure and deletes for real.
      const call2 = await fault.sweepHarnessFaults({ maxMs: 5_000, cursor: call1.cursor });
      ok(call2.failed === 0 && call2.deleted === 5,
        `F-706/${mode}: with the count spent the deletes land — deleted ${call2.deleted}, failed ${call2.failed}`);
      ok(call2.complete === true && call2.cursor === null && call2.failedResume === null,
        `F-706/${mode}: and the drain converges — complete:true, cursor:null, nothing unresolved (got ${JSON.stringify({ complete: call2.complete, cursor: call2.cursor, failedResume: call2.failedResume })})`);
      ok((await countPrefix(PLANT)) === 0, "…over an empty plant keyspace");

      /* ── AND THE OTHER HALF OF F-683: a batch that fails PARTIALLY lands its survivors, so
       * the call keeps going and ends `deletes-failed` rather than `deletes-failing`. Same
       * lever, one unit shallower than the batch. ── */
      await purge();
      await plantAll(5, true);
      await fault.armDeleteFault({ prefix: PLANT, mode, count: fault.KVS_DELETE_BATCH - 1, ttlSeconds: 60 });
      const partial = await fault.sweepHarnessFaults({ maxMs: 5_000 });
      ok(partial.failed === fault.KVS_DELETE_BATCH - 1 && partial.deleted === 5 - (fault.KVS_DELETE_BATCH - 1),
        `F-706/${mode}: a PARTIAL batch failure does not stop the call (failed ${partial.failed}, deleted ${partial.deleted})`);
      ok(partial.reason === "deletes-failed" && partial.complete === false && typeof partial.failedResume === "string",
        `F-683 through the live lever: it walked to the end and is STILL not complete, because it left rows it condemned (got ${JSON.stringify({ reason: partial.reason, complete: partial.complete })})`);
      const partial2 = await fault.sweepHarnessFaults({ maxMs: 5_000, cursor: partial.cursor });
      ok(partial2.complete === true && partial2.failed === 0 && (await countPrefix(PLANT)) === 0,
        `F-706/${mode}: …and the retry finishes the job (got ${JSON.stringify({ complete: partial2.complete, deleted: partial2.deleted })})`);
    }

    /* ── NEGATIVE CONTROL BY STASH. The same five rows, the same three calls, with the lever
     * REMOVED: if this also produced `deletes-failing` the section above would be measuring
     * the mock, not the lever. ── */
    await purge();
    await plantAll(5, true);
    await fault.armDeleteFault({ prefix: PLANT, mode: "refuse", count: fault.KVS_DELETE_BATCH, ttlSeconds: 60 });
    const stashed = await storage.get(leverKey);
    ok(stashed && stashed.mode === "refuse", "(fixture) the lever row is really there before the stash");
    await storage.delete(leverKey);
    const noLever = await fault.sweepHarnessFaults({ maxMs: 5_000 });
    ok(noLever.failed === 0 && noLever.deleted === 5 && noLever.complete === true && noLever.reason === null,
      `F-706 (negative control): with the lever stashed the IDENTICAL fixture sweeps clean in one call (got ${JSON.stringify({ failed: noLever.failed, deleted: noLever.deleted, complete: noLever.complete })})`);

    /* ── THE CLEAR OBEYS THE SAME LEVER, because both now share ONE delete batch. ── */
    await purge();
    await plantAll(5, false);
    await fault.armDeleteFault({ prefix: PLANT, mode: "throttle", count: fault.KVS_DELETE_BATCH, ttlSeconds: 60 });
    const clear1 = await fault.clearPlantedFaults({ maxMs: 5_000 });
    ok(clear1.reason === "deletes-failing" && clear1.failed === fault.KVS_DELETE_BATCH && clear1.complete === false,
      `F-706: clearPlantedFaults answers the same contract under the same lever (got ${JSON.stringify({ reason: clear1.reason, failed: clear1.failed })})`);
    let ct = clear1.cursor, lastClear = clear1, guard = 0;
    while (ct && guard++ < 10) { lastClear = await fault.clearPlantedFaults({ maxMs: 5_000, cursor: ct }); ct = lastClear.cursor; }
    ok(lastClear.complete === true && (await countPrefix(PLANT)) === 0,
      "…and drains to complete once the count is spent, exactly like the sweep");
    await purge();

    /* ── SOURCE: ONE CONSULT SITE. The sweep and the clear ran two byte-identical copies of
     * the delete batch; a lever consulted in two places is a lever with two behaviours. ── */
    /* F-779 — derived for the same reason as F-691's tail count above. The delete sites are
       the paged drains PLUS F-708's stale-tail removal, which is not a paged walk — so the
       rule asserted here is "at least one per drain, and not a single hand-rolled copy",
       never a literal that a new lever breaks by existing. */
    const deleteSites = (faultCode.match(/await settleDeletes\(batch, deleteFault\)/g) || []).length;
    ok(deleteSites > DRAINS,
      `F-706.SOURCE: every drain goes through the ONE shared delete batch, and so does F-708's stale-tail removal (${deleteSites} sites, ${DRAINS} drains)`);
    ok(!/Promise\.allSettled\(batch\.map\(\(key\) => storage\.delete\(key\)\)\)/.test(faultCode),
      "F-706.SOURCE: …and neither keeps its own copy of it any more");
    ok((faultCode.match(/await loadDeleteFault\(\)/g) || []).length === deleteSites,
      `F-706.SOURCE: the lever is read ONCE PER CALL, not once per batch — one read per delete site (${deleteSites})`);
    ok((faultCode.match(/harnessFaultArmed\(HARNESS_FAULT_DELETE/g) || []).length === 1,
      "F-706.SOURCE: and spent through the ONE counted-consumption home, in one place");
    ok(/if \(prefix !== HARNESS_FAULT_PLANT_PREFIX\)/.test(faultCode),
      "F-706.SOURCE: the prefix is tested by EQUALITY against the plant's — never by `startsWith` at the arming side");
  }


  /* ═════ 7j. F-707 — THE RESUME HANDLE BELONGS TO THE FAILURE, NOT TO THE BUDGET ═════
   *
   * MEASURED on this mock (writes to `plant:004`/`plant:005` refused): the lever answered
   * `truncated:true, reason:"writes-failed"` — and `nextIndex: 9`, because the index half of
   * the answer was read off the LOCAL budget flag (`truncated ? i : count`) while the
   * finishedness half came from `sweepAnswerTail`. The documented loop then POSTed
   * `startIndex: 9`, wrote nothing, and was answered `complete: true`: a failed plant
   * reported as a finished one, over a keyspace with two holes in it, and the sweep test
   * that followed counted 7 rows and blamed the sweep.
   *
   * The keys are `i`-derived and re-planting is idempotent, so the only honest handle is the
   * LOWEST index that did not land. Driven here with the breaker's exact inputs. */
  {
    await purge();
    const PLANT707 = fault.HARNESS_FAULT_PLANT_PREFIX;
    const setBefore707 = kvs.set;
    const refused707 = new Set([fault.plantedFaultKey(4), fault.plantedFaultKey(5)]);
    kvs.set = async function refusingSet707(key, value, options) {
      if (refused707.has(String(key))) {
        const e = new Error("HARNESS_WRITE_FAULT"); e.code = "HARNESS_WRITE_FAULT"; throw e;
      }
      return setBefore707.call(this, key, value, options);
    };

    const call1 = await fault.plantHarnessFaults({ n: 9, expired: true, maxMs: 20_000 });
    ok(call1.ok === true && call1.planted === 7 && call1.failed === 2,
      `(fixture) a 9-row plant with two refused writes places 7 (planted ${call1.planted}, failed ${call1.failed})`);
    ok(call1.truncated === true && call1.reason === "writes-failed" && call1.complete === false,
      `F-707: a plant that could not write what it named is NOT finished (got ${JSON.stringify({ truncated: call1.truncated, reason: call1.reason, complete: call1.complete })})`);
    ok(call1.nextIndex === 4,
      `F-707: …and \`nextIndex\` is the FIRST index that did not land — never \`n\`, which is where the old answer pointed (got ${call1.nextIndex})`);

    /* THE LOOP THE DOOR DOCUMENTS, DRIVEN VERBATIM. Under the old answer this second call
     * was the bug: `startIndex: 9` over a 9-row population wrote nothing and answered
     * `complete: true`. It must now land back ON the holes. */
    const resumed = await fault.plantHarnessFaults({ n: 9, expired: true, startIndex: call1.nextIndex, maxMs: 20_000 });
    ok(resumed.startIndex === 4 && resumed.complete === false && resumed.reason === "writes-failed" && resumed.nextIndex === 4,
      `F-707: the resumed call lands on the failures and still refuses to call itself complete (got ${JSON.stringify({ startIndex: resumed.startIndex, nextIndex: resumed.nextIndex, complete: resumed.complete })})`);
    ok((await countPrefix(PLANT707)) === 7,
      "F-707: …and the keyspace never pretends to hold nine rows while two of them do not exist");

    /* ── F-745 — A `writes-failed` ANSWER SAID `resume: "start-index"` OVER AN INDEX THAT HAD
     * NOT MOVED. `resumed` above is the exact shape: `startIndex: 4`, `nextIndex: 4`, and an
     * instruction to "carry on from `nextIndex`" that is an instruction to POST the identical
     * body — the spin both live drivers stop on, wearing the name of progress. They each
     * hand-write `reason === "writes-failed"` → failure to avoid it; that judgement now lives
     * in the one mapping, as a fourth word. ── */
    ok(resumed.resume === "stop",
      `F-745: a \`writes-failed\` answer whose index did not move says STOP, never "carry on from where you already are" (resume ${JSON.stringify(resumed.resume)})`);
    ok(resumed.nextIndex === resumed.startIndex,
      "F-745: …and that really is the non-advancing shape, so the old `start-index` was an instruction to spin");
    ok(call1.resume === "stop" && call1.nextIndex > call1.startIndex,
      `F-745: …and an ADVANCING \`writes-failed\` stops too — refused writes mean a short population, which is a failure and not a resume, exactly as both live drivers already judge it (resume ${JSON.stringify(call1.resume)})`);

    const stuck = await plantAll(9, true);
    ok(stuck.complete === false && stuck.calls <= 3,
      `F-707: the fixture's own drain loop TERMINATES on the stuck plant and reports it unfinished (calls ${stuck.calls}, complete ${stuck.complete})`);

    /* ── THE NEGATIVE CONTROL: the identical fixture with the refusing write PUT BACK the way
     * it was. If this also answered `writes-failed` the section above would be measuring the
     * loop and not the lever. ── */
    kvs.set = setBefore707;
    await purge();
    const clean = await fault.plantHarnessFaults({ n: 9, expired: true, maxMs: 20_000 });
    ok(clean.planted === 9 && clean.failed === 0 && clean.nextIndex === 9 && clean.reason === null && clean.complete === true,
      `F-707 (negative control): with the write fault removed the SAME 9-row plant completes in one call (got ${JSON.stringify({ planted: clean.planted, nextIndex: clean.nextIndex, complete: clean.complete })})`);
    ok((await countPrefix(PLANT707)) === 9, "…with all nine rows really in the store");
    await purge();

    ok(/failureFirst \? firstFailedIndex/.test(faultCode),
      "F-707.SOURCE: the resume handle is taken from the first failed index, in one expression");
    ok(!/nextIndex: truncated \? i : count,/.test(faultCode),
      "F-707.SOURCE: …and the budget-only expression is no longer the whole of it");
  }


  /* ═════ 7k. F-708 — `startIndex` IS JUDGED AGAINST THE POPULATION ═════
   *
   * MEASURED: `plantHarnessFaults({ n: 5, startIndex: 400 })` answered
   * `{planted:0, n:5, startIndex:400, nextIndex:5, complete:true}` — a no-op whose own
   * `nextIndex` is BELOW the `startIndex` it was handed, over a keyspace it never looked at,
   * and every documented drain loop reads `complete: true` as "the population is planted".
   * The input is not hypothetical: F-707's old answer produced exactly this `startIndex`, and
   * any caller carrying a `nextIndex` from a larger previous population produces it too.
   *
   * The mirror case is the same defect from the other side: the keys are `i`-derived, so a
   * SMALLER re-plant used to overwrite the head and leave the old tail alive for the rest of
   * its window, under an answer whose `n` and `keys` described a population the store did not
   * hold. ── */
  {
    await purge();
    const PLANT708 = fault.HARNESS_FAULT_PLANT_PREFIX;

    const past = await fault.plantHarnessFaults({ n: 5, startIndex: 400, expired: true });
    ok(past.ok === false && past.reason === "bad-start",
      `F-708: a \`startIndex\` past the population is REFUSED, never a green no-op (got ${JSON.stringify(past)})`);
    ok(past.n === 5 && past.startIndex === 400 && past.complete === undefined,
      `F-708: …and the refusal names both numbers and carries no finished signal at all (got ${JSON.stringify(past)})`);
    ok((await countPrefix(PLANT708)) === 0, "F-708: …and the refused call planted nothing");

    const noop = await fault.plantHarnessFaults({ n: 5, startIndex: 5, expired: true });
    ok(noop.ok === true && noop.planted === 0 && noop.nextIndex === 5 && noop.complete === true && noop.noop === true,
      `F-708: \`startIndex === n\` is the ONE start past the last row that is not a mistake — the loop's own final answer — and it says so explicitly (got ${JSON.stringify({ planted: noop.planted, nextIndex: noop.nextIndex, complete: noop.complete, noop: noop.noop })})`);
    ok(noop.startIndex === noop.nextIndex,
      "F-708: …with an answer that no longer contradicts itself by pointing BEHIND its own start");
    ok((await countPrefix(PLANT708)) === 0, "F-708: …and it wrote nothing either");

    /* ── THE SMALLER RE-PLANT. Twenty rows, then five: the tail must GO, and be reported. ── */
    await purge();
    const twenty = await fault.plantHarnessFaults({ n: 20, expired: false, maxMs: 20_000 });
    ok(twenty.planted === 20 && twenty.cleared === 0 && (await countPrefix(PLANT708)) === 20,
      `(fixture) a 20-row population in the store, having cleared nothing (planted ${twenty.planted}, cleared ${twenty.cleared})`);
    const five = await fault.plantHarnessFaults({ n: 5, expired: false, maxMs: 20_000 });
    ok(five.planted === 5 && five.n === 5 && five.complete === true,
      `(fixture) a smaller re-plant of five (planted ${five.planted})`);
    ok(five.cleared === 15,
      `F-708: …which REMOVED the fifteen rows of the old population it no longer names, and reported them (cleared ${five.cleared})`);
    ok((await countPrefix(PLANT708)) === 5,
      "F-708: …so the keyspace holds exactly the population the answer describes, not the union of two plants");

    /* A RESUMED call is mid-population and must NOT pay for the scan or remove anything. */
    await purge();
    await fault.plantHarnessFaults({ n: 20, expired: false, maxMs: 20_000 });
    const resumedClear = await fault.plantHarnessFaults({ n: 10, startIndex: 5, expired: false, maxMs: 20_000 });
    ok(resumedClear.cleared === 0 && (await countPrefix(PLANT708)) === 20,
      `F-708: a RESUMED call clears nothing — it is inside a population, not replacing one (cleared ${resumedClear.cleared})`);

    /* ── THE NEGATIVE CONTROL: the identical pair of calls with the SAME population size,
     * which is the case the clear must not touch. If the tail vanished here the section
     * above would be measuring the re-plant and not the shrink. ── */
    await purge();
    await fault.plantHarnessFaults({ n: 20, expired: false, maxMs: 20_000 });
    const same = await fault.plantHarnessFaults({ n: 20, expired: false, maxMs: 20_000 });
    ok(same.cleared === 0 && same.planted === 20 && (await countPrefix(PLANT708)) === 20,
      `F-708 (negative control): re-planting the SAME population removes nothing (cleared ${same.cleared}, rows ${await countPrefix(PLANT708)})`);
    await purge();

    ok(/plantStartRefusal\(startIndex, population\)/.test(faultCode) && /return "bad-start"/.test(faultCode),
      "F-708/F-723.SOURCE: the start is compared against the POPULATION, in one guard");
    ok(/plantCountClamped = \(n, startIndex = 0\) =>\s*\n?\s*Math\.min\(plantMaxForCall\(startIndex\), plantPopulationClamped\(n\)\)/.test(faultCode),
      "F-708.SOURCE: …and the per-call end index is DERIVED from the population clamp, so the two numbers cannot drift apart");
  }


  /* ═════ 7k-bis. F-723 — THE START IS JUDGED BEFORE IT IS CLAMPED ═════
   *
   * MEASURED on this mock: `plantHarnessFaults({ n: 500, startIndex: 505 })` answered
   * `ok: true` and went to work. F-708's guard was `from > population`, where `from` is
   * `plantStartIndexClamped(startIndex)` — ceiling `HARNESS_FAULT_PLANT_MAX - 1`. At the
   * LARGEST population the two ceilings collide: 505 was clamped to 499, 499 is not `> 500`,
   * and the refusal F-708 exists for could not fire AT ALL at `n = HARNESS_FAULT_PLANT_MAX`.
   * The caller's corrupt handle became an ordinary resumed call that writes one row and hands
   * back `nextIndex: 500` — `complete` over a keyspace holding one row of five hundred.
   *
   * The clamp is not the defect and is not changed (7g still asserts its totality); the ORDER
   * is. Judge the raw value, then clamp what was accepted. ── */
  {
    await purge();
    const MAXPOP = fault.HARNESS_FAULT_PLANT_MAX;
    const PLANT723 = fault.HARNESS_FAULT_PLANT_PREFIX;

    /* THE BREAKER, with the exact inputs. Under the old order this was `ok: true`. */
    const collide = await fault.plantHarnessFaults({ n: MAXPOP, startIndex: MAXPOP + 5, expired: true });
    ok(collide.ok === false && collide.reason === "bad-start",
      `F-723: at n = HARNESS_FAULT_PLANT_MAX a start past the population is STILL refused — the clamp's ceiling no longer swallows the mistake (got ${JSON.stringify(collide)})`);
    ok(collide.startIndex === MAXPOP + 5 && collide.n === MAXPOP && collide.complete === undefined,
      `F-723: …and the refusal echoes the number the CALLER sent, not the clamped one it can do nothing about (got ${JSON.stringify(collide)})`);
    ok((await countPrefix(PLANT723)) === 0, "F-723: …and the refused call planted nothing");

    /* EXACTLY AT the population is the loop's own last POST and is NOT a mistake — unchanged
     * by this fix, at the same size that produced the collision. */
    const atEnd = await fault.plantHarnessFaults({ n: MAXPOP, startIndex: MAXPOP, expired: true });
    ok(atEnd.ok === true && atEnd.noop === true && atEnd.planted === 0
      && atEnd.nextIndex === MAXPOP && atEnd.complete === true,
      `F-723 (unchanged): \`startIndex === n\` at the largest population is still the documented no-op (got ${JSON.stringify({ ok: atEnd.ok, noop: atEnd.noop, nextIndex: atEnd.nextIndex, complete: atEnd.complete })})`);
    ok((await countPrefix(PLANT723)) === 0, "F-723: …and it wrote nothing either");

    /* A SUPPLIED handle that is not a non-negative integer is a MISTAKE, not a fresh plant:
     * silently becoming 0 rewrote a population from the top for a caller carrying junk. */
    for (const junk of [-9, 1.5, "banana", {}, NaN]) {
      const bad = await fault.plantHarnessFaults({ n: 5, startIndex: junk, expired: true });
      ok(bad.ok === false && bad.reason === "bad-start",
        `F-723: a supplied \`startIndex\` of ${JSON.stringify(String(junk))} is refused, never silently treated as a fresh plant (got ${JSON.stringify(bad)})`);
    }
    ok((await countPrefix(PLANT723)) === 0, "F-723: …and none of those refusals touched the keyspace");

    /* ═════ F-746 — `Number()` IS NOT "IS IT AN INTEGER", AND `""` WAS THE EXPENSIVE ONE ═════
     *
     * The judge ran the caller's value through JavaScript's most forgiving coercion, which
     * admits four shapes nobody meant to send: `""` → 0, `"  3 "` → 3, `"3.0"` → 3,
     * `"0x2"` → 2. `""` is the one that costs: it is what a form post, a shell
     * `--start-index=$UNSET` or a JSON body built from a missing variable produces, it read
     * as index 0, and index 0 is a FRESH plant — which DELETES every row at or past `n`
     * before writing. A caller that meant to resume at 6 and sent nothing had the tail of
     * its own population destroyed under `ok: true`.
     *
     * Driven over a REAL population, so the refusal is measured by what survives. ── */
    await purge();
    const seeded746 = await fault.plantHarnessFaults({ n: 9, expired: true, maxMs: 20_000 });
    ok(seeded746.planted === 9 && (await countPrefix(PLANT723)) === 9,
      `(fixture) a 9-row population for the coercions to be judged against (planted ${seeded746.planted})`);

    for (const junk of ["", "  3 ", "3.0", "0x2", "+3", "3e0", " ", "\t"]) {
      const bad = await fault.plantHarnessFaults({ n: 5, startIndex: junk, expired: true, maxMs: 20_000 });
      ok(bad.ok === false && bad.reason === "bad-start",
        `F-746: a supplied \`startIndex\` of ${JSON.stringify(junk)} is \`bad-start\`, never a number \`Number()\` was willing to invent (got ${JSON.stringify({ ok: bad.ok, reason: bad.reason })})`);
    }
    ok((await countPrefix(PLANT723)) === 9,
      `F-746: …and NONE of them ran as a fresh plant of 5, which would have deleted rows 5..8 of a population the caller still wanted (rows ${await countPrefix(PLANT723)})`);

    /* The numbers `Number.isInteger` let through that are not indexes either. */
    for (const junk of [Infinity, -Infinity, 1e21, Number.MAX_SAFE_INTEGER + 2, -0.5]) {
      ok(fault.plantStartRefusal(junk, 500) === "bad-start",
        `F-746: …and a NUMBER that is not a non-negative SAFE integer is refused too (${String(junk)})`);
    }
    ok(fault.plantStartRefusal("99999999999999999999", 500) === "bad-start",
      "F-746: …including a digit string long enough to lose precision, which is not an index anyone can resume at");

    /* ── THE NEGATIVE CONTROL: the two shapes that ARE accepted, and they still are. A digit
     * string is how a JSON door spells a number, and refusing it would break every resumed
     * POST this repo makes. ── */
    ok(fault.plantStartRefusal("3", 5) === null && fault.plantStartRefusal("0", 5) === null
      && fault.plantStartRefusal("5", 5) === null && fault.plantStartRefusal(3, 5) === null,
      "F-746 (negative control): a plain digit string and a plain non-negative integer are the two accepted shapes");
    const resumedStr = await fault.plantHarnessFaults({ n: 9, startIndex: "9", expired: true, maxMs: 20_000 });
    ok(resumedStr.ok === true && resumedStr.noop === true && resumedStr.startIndex === 9,
      `F-746 (negative control): …and a digit-string start really does drive the lever (got ${JSON.stringify({ ok: resumedStr.ok, startIndex: resumedStr.startIndex })})`);
    ok((await countPrefix(PLANT723)) === 9, "F-746 (negative control): …without disturbing the population");
    await purge();

    ok(/const PLANT_START_DIGITS = \/\^\\d\+\$\/;/.test(faultCode),
      "F-746.SOURCE: the accepted string grammar is a named constant, not a coercion");
    ok(!/const parsed = Number\(startIndex\);\n  if \(!Number\.isInteger\(parsed\)/.test(faultCode),
      "F-746.SOURCE: …and the blanket `Number()` judgement is gone");

    /* THE NEGATIVE CONTROL: ABSENT is not junk. A first POST carries no `startIndex` at all
     * and must still be the fresh plant every driver in this repo opens with. */
    for (const absent of [undefined, null]) {
      await purge();
      const fresh = await fault.plantHarnessFaults({ n: 2, startIndex: absent, expired: true, maxMs: 20_000 });
      ok(fresh.ok === true && fresh.startIndex === 0 && fresh.planted === 2 && fresh.complete === true,
        `F-723 (negative control): a MISSING start is a fresh plant, exactly as before (got ${JSON.stringify({ ok: fresh.ok, startIndex: fresh.startIndex, planted: fresh.planted })})`);
    }
    await purge();

    /* The judgement is PURE and has one home, so the door and the lever cannot disagree. */
    ok(fault.plantStartRefusal(undefined, 5) === null && fault.plantStartRefusal(null, 5) === null
      && fault.plantStartRefusal(5, 5) === null && fault.plantStartRefusal(0, 5) === null,
      "F-723: `plantStartRefusal` accepts absent, zero and exactly-at-the-population");
    ok(fault.plantStartRefusal(6, 5) === "bad-start" && fault.plantStartRefusal(-1, 5) === "bad-start"
      && fault.plantStartRefusal("banana", 5) === "bad-start"
      && fault.plantStartRefusal(MAXPOP + 5, MAXPOP) === "bad-start",
      "F-723: …and refuses past-the-end and junk, including at the largest population");
    ok(fault.HARNESS_UNGATED_EXPORTS.includes("plantStartRefusal"),
      "F-723: …and it is on the UNGATED census, because it reaches no storage");

    ok(faultCode.indexOf("const startRefusal = plantStartRefusal(startIndex, population);")
      < faultCode.indexOf("const from = plantStartIndexClamped(startIndex, population);"),
      "F-723.SOURCE: the judgement happens BEFORE the clamp — the order IS the fix");
    ok(/const from = plantStartIndexClamped\(startIndex, population\);/.test(faultCode),
      "F-723.SOURCE: …and the lever clamps the accepted start to the POPULATION, never to the keyspace's last index");
  }


  /* ═════ 7k-ter. F-724 — THE `clearing` ANSWER'S RE-POST CONTRACT WAS PROSE ═════
   *
   * A fresh plant whose stale clear runs out of budget answers `truncated: true,
   * reason: "clearing", planted: 0, nextIndex: startIndex` — deliberately NOT advancing,
   * because nothing was planted and the caller must send the SAME body again. That contract
   * lived only in a comment, and BOTH live drivers (`plant-sweep-live.mjs` ~:233,
   * `delete-fault-drain-live.mjs` ~:443) implement exactly one rule — "a `nextIndex` that
   * does not advance is a stuck plant, stop" — so the answer was, to every consumer this repo
   * ships, indistinguishable from a spin.
   *
   * The producer half: say it in FIELDS. `resume: "repost"` is the instruction, and
   * `clearedSoFar` / `remainingStale` are the progress a non-advancing index cannot show. ── */
  {
    await purge();
    const PLANT724 = fault.HARNESS_FAULT_PLANT_PREFIX;
    const big = await fault.plantHarnessFaults({ n: 30, expired: false, maxMs: 20_000 });
    ok(big.planted === 30 && (await countPrefix(PLANT724)) === 30,
      `(fixture) a 30-row population to be shrunk (planted ${big.planted})`);
    ok(big.resume === null && big.complete === true,
      `F-724: a FINISHED plant has nothing to resume (resume ${JSON.stringify(big.resume)})`);

    /* The shrink: 30 → 2 condemns 28 rows, and a 1 ms budget cannot finish them. */
    const clearing = await fault.plantHarnessFaults({ n: 2, expired: false, maxMs: 1 });
    ok(clearing.ok === true && clearing.truncated === true && clearing.reason === "clearing"
      && clearing.planted === 0 && clearing.complete === false,
      `(fixture) the stale clear ran out of budget and answered \`clearing\` (got ${JSON.stringify({ reason: clearing.reason, planted: clearing.planted, complete: clearing.complete })})`);
    ok(clearing.nextIndex === clearing.startIndex,
      "F-724 (unchanged): `clearing` still does NOT advance `nextIndex` — that is the contract, not the defect");
    ok(clearing.resume === "repost",
      `F-724: …and the answer now SAYS so, in a field a driver can switch on (resume ${JSON.stringify(clearing.resume)})`);

    /* F-747 — ONE FIELD NAME, ONE MEANING. `failed` carried the CLEAR's failures here and
     * the WRITES' failures in the `clear-failed` branch four lines away, in the same
     * function — and `failed > 0` is what `sweepAnswerTail` turns into `writes-failed`, so
     * a reader (or a future tail) could read refused DELETES as refused WRITES. The clear's
     * count is `staleFailed` in BOTH branches now, and `failed` is writes, always. */
    ok(clearing.failed === 0,
      `F-747: a \`clearing\` answer plants NOTHING, so its \`failed\` — which means WRITES — is 0 (got ${clearing.failed})`);
    ok(clearing.staleFailed === 0,
      `F-747: …and the clear's own failure count is \`staleFailed\`, here zero because this clear ran out of BUDGET, not of luck (got ${clearing.staleFailed})`);
    ok(clearing.clearedSoFar > 0,
      `F-724: …naming the progress it DID make (clearedSoFar ${clearing.clearedSoFar})`);
    ok(Number.isInteger(clearing.remainingStale) && clearing.remainingStale > 0
      && clearing.clearedSoFar + clearing.remainingStale === 28,
      `F-724: …and how much of the condemned 28 is left, so "converging" is measurable without an index (cleared ${clearing.clearedSoFar}, remaining ${clearing.remainingStale})`);

    /* F-744 — `clearedSoFar` IS THE DRAIN'S TOTAL, AND A TRAIL IS THE ONLY THING THAT PROVES
     * IT. It used to be `clearedSoFar: cleared` — a byte-copy of the per-CALL count — so the
     * assertion `clearedSoFar === cleared` was a tautology that passed over the defect. The
     * honest test is the TRAIL: carry the answer's `clearToken` into the identical re-POST
     * and watch the number RISE, call over call, to the size of the condemned set. ── */
    ok(typeof clearing.clearToken === "string" && clearing.clearToken.length > 0,
      `F-744: a \`repost\` answer hands back the token that carries its running count (clearToken ${typeof clearing.clearToken})`);
    ok(fault.decodeSweepToken(clearing.clearToken).clearedSoFar === clearing.clearedSoFar,
      "F-744: …and the token's `s` IS the reported total — one number, one home");
    ok(fault.decodeSweepToken(clearing.clearToken).cursor === null
      && fault.decodeSweepToken(clearing.clearToken).unresolved === false,
      "F-744: …carried on the sweep's own grammar with `c`/`f` untouched, so a consumer that ignores `s` reads the token it always did");

    /* THE CONTRACT, DRIVEN VERBATIM: the SAME body, again, until it is not `repost`. It must
     * CONVERGE — the rows a clearing call removed are gone for good. */
    let last = clearing, hops = 0, previousRemaining = clearing.remainingStale;
    let previousCleared = clearing.clearedSoFar;
    const trail = [clearing.clearedSoFar];
    while (last.resume === "repost" && hops < 40) {
      hops++;
      last = await fault.plantHarnessFaults({ n: 2, expired: false, maxMs: 1, clearToken: last.clearToken });
      trail.push(last.clearedSoFar);
      ok(last.clearedSoFar > previousCleared,
        `F-744: every re-POST STRICTLY RAISES the running total (${previousCleared} → ${last.clearedSoFar})`);
      previousCleared = last.clearedSoFar;
      if (last.resume === "repost") {
        ok(last.remainingStale < previousRemaining,
          `F-724: every re-POST strictly SHRINKS the remaining stale set (${previousRemaining} → ${last.remainingStale})`);
        previousRemaining = last.remainingStale;
      }
    }
    ok(trail.length >= 2 && last.clearedSoFar === 28,
      `F-744: …and the trail of a 28-row clear at maxMs:1 ends on the WHOLE condemned set, not on one call's share (trail ${JSON.stringify(trail)})`);
    ok(last.resume !== "repost" && last.planted === 2 && (await countPrefix(PLANT724)) === 2,
      `F-724: …and the identical re-POST loop terminates on a real plant of the population it asked for (hops ${hops}, planted ${last.planted}, rows ${await countPrefix(PLANT724)})`);

    /* THE CALLER THAT IGNORES THE FIELD MUST STILL WORK: no `clearToken`, same drain, same
     * convergence — only an understated total, because the count decides NOTHING. */
    await purge();
    await fault.plantHarnessFaults({ n: 30, expired: false, maxMs: 20_000 });
    let blind = await fault.plantHarnessFaults({ n: 2, expired: false, maxMs: 1 });
    let blindHops = 0;
    while (blind.resume === "repost" && blindHops < 40) {
      blindHops++;
      blind = await fault.plantHarnessFaults({ n: 2, expired: false, maxMs: 1 });
    }
    ok(blind.planted === 2 && (await countPrefix(PLANT724)) === 2 && blind.clearedSoFar < 28,
      `F-744 (compat): a consumer that drops \`clearToken\` still converges, it just under-counts (hops ${blindHops}, clearedSoFar ${blind.clearedSoFar})`);

    /* F-744 — AND AN ARMED LEVER MAKES `clearing` ANSWERS REPEAT, BOUNDEDLY.
     *
     * Under `armDeleteFault({ mode: "refuse" })` the first batch of a clear can land NOTHING,
     * so the call clears 0, condemns the same set and answers BYTE-IDENTICALLY to the one
     * before it. That is the lever, not a spin — and the docblock now says so. What makes it
     * safe is arithmetic, not hope: `DELETE_FAULT_DRAINABLE_MAX` is derived from
     * `DRAIN_IDENTICAL_ANSWER_LIMIT * KVS_DELETE_BATCH - 1`, so the lever runs out of units
     * with a call to spare and the identical RUN is always shorter than the limit a drain
     * helper stops on. Measured, at the lever's maximum arming. ── */
    await purge();
    await fault.plantHarnessFaults({ n: 30, expired: false, maxMs: 20_000 });
    const maxArmed = await fault.armDeleteFault({
      prefix: PLANT724, mode: "refuse", count: fault.DELETE_FAULT_DRAINABLE_MAX, ttlSeconds: 60,
    });
    ok(maxArmed.count === fault.DELETE_FAULT_DRAINABLE_MAX,
      `(fixture) the delete lever armed to its DRAINABLE_MAX (count ${maxArmed.count})`);

    let armedRun = 0, longestRun = 0, prevAnswer = null, armedHops = 0;
    let armedLast = null;
    do {
      armedHops++;
      armedLast = await fault.plantHarnessFaults({
        n: 2, expired: false, maxMs: 20_000, clearToken: armedLast ? armedLast.clearToken : undefined,
      });
      const shape = JSON.stringify({ r: armedLast.reason, c: armedLast.clearedSoFar, s: armedLast.remainingStale });
      armedRun = shape === prevAnswer ? armedRun + 1 : 1;
      if (armedRun > longestRun) longestRun = armedRun;
      prevAnswer = shape;
    } while (armedLast.resume === "repost" && armedHops < 40);

    ok(longestRun < fault.DRAIN_IDENTICAL_ANSWER_LIMIT,
      `F-744: the identical-answer run an armed lever can produce is SHORTER than the drain's spin limit (run ${longestRun} < ${fault.DRAIN_IDENTICAL_ANSWER_LIMIT})`);
    ok(armedLast.resume !== "repost" && armedLast.planted === 2 && (await countPrefix(PLANT724)) === 2,
      `F-744: …and the lever's own cap is what converges it — the drain finishes without ever tripping the limit (hops ${armedHops}, rows ${await countPrefix(PLANT724)})`);
    await purge();  // purge() removes the lever row too — it lives under `harness_fault:`.

    /* THE NEGATIVE CONTROL: a plant that is merely TRUNCATED resumes the other way, and its
     * index really does move. If this also said `repost` the field would say nothing. */
    await purge();
    const cut = await fault.plantHarnessFaults({ n: 500, expired: true, maxMs: 20_000 });
    ok(cut.reason === "call-max" && cut.resume === "start-index" && cut.nextIndex > cut.startIndex,
      `F-724 (negative control): a call-max truncation resumes from an ADVANCING \`nextIndex\` (got ${JSON.stringify({ reason: cut.reason, resume: cut.resume, nextIndex: cut.nextIndex })})`);
    await purge();

    ok(fault.plantResumeMode("clearing", false) === "repost"
      && fault.plantResumeMode("budget", false) === "start-index"
      && fault.plantResumeMode("call-max", false) === "start-index"
      && fault.plantResumeMode("writes-failed", false) === "stop"
      && fault.plantResumeMode(null, true) === null,
      "F-724/F-745: `plantResumeMode` is the ONE mapping from a stop reason to how it is resumed");
    ok(fault.PLANT_REPOST_REASONS.includes("clearing") && !fault.PLANT_REPOST_REASONS.includes("budget")
      && !fault.PLANT_REPOST_REASONS.includes("call-max") && !fault.PLANT_REPOST_REASONS.includes("writes-failed"),
      "F-724: …and the re-POST answers are exactly the clear's, never a resumable truncation");
    ok(fault.HARNESS_UNGATED_EXPORTS.includes("plantResumeMode")
      && fault.HARNESS_UNGATED_EXPORTS.includes("PLANT_REPOST_REASONS")
      && fault.HARNESS_UNGATED_EXPORTS.includes("PLANT_STOP_REASONS"),
      "F-724/F-745: …all on the UNGATED census, because none of them reaches storage");

    /* F-745: the fourth word, and the two clauses that produce it. The NEGATIVE control is
     * the whole point — a truncation that really does advance must still say `start-index`,
     * or `stop` would mean nothing. */
    ok(fault.PLANT_STOP_REASONS.includes("writes-failed")
      && !fault.PLANT_STOP_REASONS.includes("budget") && !fault.PLANT_STOP_REASONS.includes("call-max")
      && !fault.PLANT_STOP_REASONS.includes("clearing"),
      "F-745: `writes-failed` is the one stop reason, in its one home beside the re-POST vocabulary");
    ok(fault.plantResumeMode("budget", false, false) === "stop"
      && fault.plantResumeMode("call-max", false, false) === "stop",
      "F-745: …and ANY non-complete, non-`repost` answer whose index did not advance is a stop — an instruction to resume where you already are is a spin");
    ok(fault.plantResumeMode("budget", false, true) === "start-index"
      && fault.plantResumeMode("budget", false) === "start-index"
      && fault.plantResumeMode("clearing", false, false) === "repost",
      "F-745 (negative control): a truncation that DID advance still carries on, the default is `advanced`, and `repost` outranks the clause — `clearing` never advances by design");
    ok(fault.plantResumeMode("writes-failed", true, false) === null,
      "F-745 (negative control): …and a COMPLETE answer has nothing to resume, whatever its reason");
    ok((faultCode.match(/resume: plantResumeMode\(/g) || []).length === 4,
      "F-724.SOURCE: every plant answer takes `resume` from the mapping — none of them hand-writes one");
  }


  /* ═════ 7k-quater. F-725 — A CLEAR THAT REFUSED DELETES IS NOT A CLEAN PLANT ═════
   *
   * `clearStalePlantedRows` returns `{cleared, failed, done}`, and the lever read `failed`
   * ONLY on the `!done` path. A clear that landed at least one delete per batch therefore
   * ended `done: true` WITH failures inside it, the lever planted over the top, and the answer
   * said `complete: true` — while rows of the previous, LARGER population were still in the
   * keyspace under an answer naming the new, smaller `n`. That is the exact shape the
   * `armDeleteFault` lever produces (one refusal per batch, the rest land), and it is LAW 3:
   * a failure reported as a success.
   *
   * Driven with the lever's own inputs. ── */
  {
    await purge();
    const PLANT725 = fault.HARNESS_FAULT_PLANT_PREFIX;
    const big = await fault.plantHarnessFaults({ n: 30, expired: false, maxMs: 20_000 });
    ok(big.planted === 30 && (await countPrefix(PLANT725)) === 30,
      `(fixture) a 30-row population to be shrunk (planted ${big.planted})`);

    /* ── BLOCK: one refused delete, every other delete in its batch landing, so the clear
     * reaches the end of the condemned set and still reports `done: true`. ── */
    const armed = await fault.armDeleteFault({ prefix: PLANT725, mode: "refuse", count: 1, ttlSeconds: 60 });
    ok(armed.count === 1, `(fixture) the delete lever armed for exactly one refusal (count ${armed.count})`);

    const shrink = await fault.plantHarnessFaults({ n: 2, expired: false, maxMs: 20_000 });
    ok(shrink.truncated === true && shrink.reason === "clear-failed" && shrink.complete === false,
      `F-725: a clear that refused a delete is NOT a complete plant — it says \`clear-failed\` (got ${JSON.stringify({ truncated: shrink.truncated, reason: shrink.reason, complete: shrink.complete })})`);
    ok(shrink.planted === 0,
      `F-725: …and it plants NOTHING over a keyspace it could not make into the one its \`n\` describes (planted ${shrink.planted})`);
    ok(shrink.staleFailed === 1 && shrink.remainingStale === 1,
      `F-725: …naming how many stale rows survived (staleFailed ${shrink.staleFailed}, remainingStale ${shrink.remainingStale})`);
    ok(shrink.failed === 0,
      `F-747: …under the SAME two names the \`clearing\` branch uses — \`failed\` is WRITES and this branch wrote nothing (got ${shrink.failed})`);
    ok(shrink.reason === "clear-failed" && shrink.resume === "repost",
      "F-747: …and `reason`/`resume` are both taken from the tail that was built from it, never hand-written a second and third time");
    ok(Array.isArray(shrink.staleFailedKeys) && shrink.staleFailedKeys.length === 1
      && shrink.staleFailedKeys[0].startsWith(PLANT725)
      && shrink.staleFailedKeys.length <= fault.CLEAR_FAILED_KEYS_REPORTED,
      `F-725: …and WHICH, capped at CLEAR_FAILED_KEYS_REPORTED (got ${JSON.stringify(shrink.staleFailedKeys)})`);
    ok((await countPrefix(PLANT725)) === 3,
      `F-725: …and the store really does still hold the survivor the old answer called complete — two kept rows plus one stale (rows ${await countPrefix(PLANT725)})`);
    ok(shrink.resume === "repost" && shrink.nextIndex === shrink.startIndex,
      `F-725: …and it is re-POSTed identically, like \`clearing\` (resume ${JSON.stringify(shrink.resume)})`);

    /* THE CONVERGENCE the `armDeleteFault` cap guarantees: the lever is count-bounded
     * (DELETE_FAULT_DRAINABLE_MAX is DERIVED from the drain's spin limit), so the very next
     * identical re-POST finds no units left and finishes the job. */
    const retry = await fault.plantHarnessFaults({ n: 2, expired: false, maxMs: 20_000 });
    ok(retry.complete === true && retry.planted === 2 && retry.resume === null,
      `F-725: the identical re-POST converges once the armed lever is spent (got ${JSON.stringify({ complete: retry.complete, planted: retry.planted })})`);
    ok((await countPrefix(PLANT725)) === 2,
      `F-725: …with the keyspace finally holding exactly the population the answer names (rows ${await countPrefix(PLANT725)})`);

    /* ── ALLOW: the identical shrink with NOTHING armed. If this also said `clear-failed` the
     * block above would be measuring the clear and not the failure. ── */
    await purge();
    await fault.plantHarnessFaults({ n: 30, expired: false, maxMs: 20_000 });
    const clean = await fault.plantHarnessFaults({ n: 2, expired: false, maxMs: 20_000 });
    ok(clean.reason === null && clean.complete === true && clean.planted === 2
      && clean.cleared === 28 && clean.staleFailed === undefined,
      `F-725 (negative control): with no delete fault armed the SAME shrink is the unchanged happy path (got ${JSON.stringify({ reason: clean.reason, complete: clean.complete, cleared: clean.cleared })})`);
    ok((await countPrefix(PLANT725)) === 2, "F-725 (negative control): …and the old tail really is gone");
    await purge();

    ok(/if \(stale\.failed > 0\) \{/.test(faultCode),
      "F-725.SOURCE: `failed` is judged on the FINISHED path too, not only on `!done`");
    ok((faultCode.match(/staleFailed: stale\.failed/g) || []).length === 2,
      "F-747.SOURCE: the clear's failure count has ONE name, and both branches use it");
    ok(!/failed: stale\.failed/.test(faultCode),
      "F-747.SOURCE: …and `failed` is never the clear's count — it is WRITE failures everywhere");
    ok((faultCode.match(/"clear-failed"/g) || []).length === 2,
      "F-747.SOURCE: `clear-failed` is written where it is DECIDED (the vocabulary, and the tail's input) and read back off the tail after that");
    ok(fault.PLANT_REPOST_REASONS.includes("clear-failed"),
      "F-725: `clear-failed` is in the re-POST vocabulary's one home, beside `clearing`");
  }


  /* ═════ 7l. F-710 — A SILENT CLAMP IS A LIE THE LOOP BELIEVES ═════
   *
   * MEASURED: `plantHarnessFaults({ n: 500 })` answered `{n:150, planted:150, nextIndex:150,
   * complete:true}`. Nothing in that object says the request was cut down — `n` had been
   * REWRITTEN to the clamp — so the only way to notice was to compare the answer to what you
   * asked for, which neither shipped drain helper did. Reaching 500 required IGNORING
   * `complete` and re-POSTing, the exact opposite of the loop `src/test-hook.js` documents,
   * and it is why a live driver's `planted === 200` assertion was red.
   *
   * The clamp stays — one call cannot outrun a trigger killed at 25 s. What changes is that
   * it is now a truncation like any other, with the population echoed beside it. ── */
  {
    await purge();
    const asked = await fault.plantHarnessFaults({ n: 500, expired: true, maxMs: 20_000 });
    ok(asked.n === 500 && asked.planted === fault.HARNESS_FAULT_PLANT_CALL_MAX,
      `F-710: a first call for 500 plants one call's worth and still says 500 (planted ${asked.planted}, n ${asked.n})`);
    ok(asked.truncated === true && asked.reason === "call-max" && asked.complete === false && asked.nextIndex === 150,
      `F-710: …truncated, with its own reason and the index to carry on from (got ${JSON.stringify({ truncated: asked.truncated, reason: asked.reason, nextIndex: asked.nextIndex, complete: asked.complete })})`);
    ok(asked.nextIndex < asked.n,
      "F-710: …so `nextIndex < n` means CARRY ON without the caller having to remember what it asked for");

    /* THE LOOP THE DOOR DOCUMENTS NOW REACHES 500 BY OBEYING `complete`, which is the whole
     * point: under the old answer it stopped at 150 and called that a planted population. */
    const full = await plantAll(500, true, { maxMs: 20_000 });
    ok(full.complete === true && full.planted === 500 && (await countPrefix(fault.HARNESS_FAULT_PLANT_PREFIX)) === 500,
      `F-710: "POST until complete" now plants the whole 500-row population (planted ${full.planted} in ${full.calls} calls)`);
    ok(full.calls >= 2, `…across at least the two calls the per-call ceiling forces (${full.calls})`);

    /* ── THE NEGATIVE CONTROL: a population that FITS in one call. If this also answered
     * `call-max` the section above would be measuring the answer shape and not the clamp. ── */
    await purge();
    const fits = await fault.plantHarnessFaults({ n: fault.HARNESS_FAULT_PLANT_CALL_MAX, expired: true, maxMs: 20_000 });
    ok(fits.n === fault.HARNESS_FAULT_PLANT_CALL_MAX && fits.planted === fault.HARNESS_FAULT_PLANT_CALL_MAX,
      `(fixture) exactly one call's worth asked for and planted (${fits.planted})`);
    ok(fits.truncated === false && fits.reason === null && fits.complete === true,
      `F-710 (negative control): a population that FITS is complete in one call, with no reason at all (got ${JSON.stringify({ truncated: fits.truncated, reason: fits.reason, complete: fits.complete })})`);
    await purge();

    ok(/if \(!truncated && count < population\) \{ truncated = true; reason = "call-max"; \}/.test(faultCode),
      "F-710.SOURCE: the clamp becomes a truncation in one place, after the loop and before the one tail");
    ok(/ok: true, planted, failed, n: population, startIndex: from,/.test(faultCode)
      && !/n: count, startIndex: from/.test(faultCode),
      "F-710.SOURCE: …and the answer's `n` is the POPULATION, never this call's end index");
  }

  globalThis.setTimeout = realTimeout;
}

/* ═════ N. THE LIVE DRIVER'S EXPECTATIONS, HELD AGAINST src ═══════════════════════
 *
 * `scripts/delete-fault-drain-live.mjs` carries three numbers it calls EXPECTATIONS —
 * `KVS_DELETE_BATCH_EXPECTED`, `HARNESS_FAULT_SWEEP_MAX_ROWS_EXPECTED` and
 * `HARNESS_FAULT_SWEEP_SCAN_CEILING_EXPECTED` — because a live driver cannot import from
 * `src/`. Its own docblocks say each is "an EXPECTATION, not a second home: the run PROVES
 * it from the tenant's own answer". That is true of a run that REACHES the proof, and the
 * whole shape of the driver is that the numbers are used BEFORE it does: `ARM_COUNT =
 * drainableArmCount(IDENTICAL_ANSWER_LIMIT, KVS_DELETE_BATCH_EXPECTED)` sizes the arm that
 * the drain is then judged against. If `KVS_DELETE_BATCH` moves in src, the driver arms the
 * wrong size and reports a finding about a drain it mis-sized itself — and nothing offline
 * says a word, because until now NOTHING compared the two files.
 *
 * This suite already imports `src/harness-fault.js`. So it is the one place where both
 * numbers exist at once, and the drift check costs an import that is already paid for.
 *
 * WHY THE DRIVER IS PARSED AND NOT IMPORTED. It self-executes: the module-scope block at the
 * bottom builds `state` and calls `run(state)`, whose first move is `requireEnvAck` — which
 * REFUSES, writes an evidence file and calls `process.exit`. Importing it would end this
 * suite. The constants are therefore read out of its SOURCE, and the parse is asserted to
 * have found something before anything is compared to it — a regex that silently matches
 * nothing would otherwise turn this whole section into three vacuous passes, which is the
 * F-772 failure (a check that reads the wrong thing and announces a pass).
 */
{
  const driverPath = path.join(here, "delete-fault-drain-live.mjs");
  const driverSrc = readFileSync(driverPath, "utf8");

  /* The self-execution, asserted rather than assumed — if this driver ever stops running on
     import, this section should be rewritten to import it, and the comment above is wrong. */
  ok(/\bawait run\(state\);/.test(driverSrc) && !/^\s*(export\s+)?async function main/m.test(driverSrc),
    "the drain driver self-executes at module scope (so its constants are PARSED, not imported)");

  const driverConst = (name) => {
    const m = driverSrc.match(new RegExp("export const " + name + "\\s*=\\s*([0-9_]+)\\s*;"));
    return m ? Number(m[1].replace(/_/g, "")) : undefined;
  };

  const expectations = [
    ["KVS_DELETE_BATCH_EXPECTED", fault.KVS_DELETE_BATCH, "KVS_DELETE_BATCH",
      "it sizes the armed fault (drainableArmCount) before any tenant answer can correct it"],
    ["HARNESS_FAULT_SWEEP_MAX_ROWS_EXPECTED", fault.HARNESS_FAULT_SWEEP_MAX_ROWS, "HARNESS_FAULT_SWEEP_MAX_ROWS",
      "it is the cap a truncated row list is judged against"],
    ["HARNESS_FAULT_SWEEP_SCAN_CEILING_EXPECTED",
      fault.HARNESS_FAULT_SWEEP_PAGE_SIZE * fault.HARNESS_FAULT_SWEEP_MAX_PAGES,
      "HARNESS_FAULT_SWEEP_PAGE_SIZE x HARNESS_FAULT_SWEEP_MAX_PAGES",
      "past it, `scanned` is a floor and the plant delta stops being exact"],
  ];
  for (const [name, srcValue, srcName, why] of expectations) {
    const got = driverConst(name);
    /* THE PARSE FIRST. A `undefined === undefined` comparison would pass while reading
       nothing at all, and a renamed constant in the driver is exactly how that happens. */
    ok(typeof got === "number",
      `the drain driver's ${name} is READ from its source (got ${got}) — a parse that found nothing must not be mistaken for agreement`);
    ok(typeof srcValue === "number",
      `…and src/harness-fault.js really exports ${srcName} (got ${srcValue})`);
    ok(got === srcValue,
      `DRIFT: delete-fault-drain-live.mjs expects ${name} = ${got}, src/harness-fault.js says ${srcName} = ${srcValue} — ${why}`);
  }

  /* POSITIVE CONTROL — the parse really reads THIS file's numbers, and a drifted driver is
     caught. The mutation is done on the source TEXT, so nothing on disk is touched. */
  {
    const drifted = driverSrc.replace("export const KVS_DELETE_BATCH_EXPECTED = 3;",
      "export const KVS_DELETE_BATCH_EXPECTED = 4;");
    ok(drifted !== driverSrc, "(fixture) the positive control really mutated the driver's source text");
    const m = drifted.match(/export const KVS_DELETE_BATCH_EXPECTED\s*=\s*([0-9_]+)\s*;/);
    ok(m && Number(m[1]) === 4 && Number(m[1]) !== fault.KVS_DELETE_BATCH,
      "POSITIVE CONTROL: a driver whose expected batch size drifts from src is caught by this parse");
  }
  ok(driverConst("KVS_DELETE_BATCH_EXPECTED_NOT_A_REAL_NAME") === undefined,
    "NEGATIVE CONTROL: the parser answers `undefined` for a name the driver does not declare — which the assertions above treat as a FAILURE, not as agreement");
}

kvs.set = realSet;
delete process.env.HARNESS_SECRET;

console.log(`\nharness-fault-ttl: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
