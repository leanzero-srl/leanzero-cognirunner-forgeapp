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
  ok((faultCode.match(/if \(!harnessEnabled\(\)\)/g) || []).length === 6,
    "SOURCE: the two new helpers are NOT exports — the six-gated-exports count is unchanged");
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

/* ═════ 3. A ROW WITH NO `until` IS NOT EXPIRED — a missing bound is not a passed one ═════ */
{
  const k = fault.harnessFaultKey(fault.HARNESS_FAULT_JIRA, PATH);
  await storage.set(k, { status: 503, armedAt: new Date().toISOString() });
  ok((await fault.jiraFaultStatus(PATH)) === 503,
    "a hand-planted row with no deadline still reads — the offline suites that plant rows keep working");
  ok(fault.faultRowExpired({ until: "not-a-date" }) === false, "…and an unparseable `until` is not a licence to expire either");
  ok(fault.faultRowExpired({ until: new Date(Date.now() + 1000).toISOString() }) === false, "a future deadline is not past");
  ok(fault.faultRowExpired({ until: new Date(Date.now() - 1000).toISOString() }) === true, "a past deadline is");
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
