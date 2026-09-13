/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-616 — THE PURGE-TOMBSTONE TEST DOOR, AND ITS GATE.
 *
 * Closing F-616 removed the only path the live driver had to re-create a Virtual
 * Administrator under the same id, which is how `va-recreate-settle-live.mjs` used to
 * drive F-575's settle window. The replacement is a dev-only action on the test hook
 * that plants or ages `va_purged:{agent}`.
 *
 * A test door is a door. What this suite proves:
 *  · IT IS 404 WITHOUT THE SECRET — no bearer, wrong bearer, and (the one that matters
 *    in production) no HARNESS_SECRET configured at all;
 *  · it refuses an agent id that names no job row, and a malformed id;
 *  · a plant lands on the SETTLE-WINDOW arm: `at` is clamped to before the job's
 *    `createdAt`, because `clearPurgeTombstone` only weighs a tombstone that predates
 *    the job — an unclamped plant would land on `tombstone_newer_than_job` and the
 *    driver would prove the wrong branch;
 *  · `age` moves `at` back far enough that the window has retired, and refuses when
 *    there is no tombstone to age;
 *  · the KEY is `vaPurgedKey`'s, and the row is one `clearPurgeTombstone` accepts —
 *    asserted by calling the REAL function both ways;
 *  · F-632 — it NEVER touches a tombstone it did not plant: clear, age and plant all
 *    refuse a row without `plantedBy:"harness"` and leave it byte-for-byte, while the
 *    harness's own tombstone still clears.
 *
 * Run: node scripts/test-hook-va-tombstone.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

forgeApi.__respond(() => forgeApi.__response(200, {}));

const SECRET = "harness-secret-616";
const { testStateTrigger } = await import("../../src/test-hook.js");
const { vaPurgedKey, VA_PURGE_SETTLE_MS } = await import("../../src/shared/va-keys.js");
const { clearPurgeTombstone } = await import("../../src/va-ledger.js");
const { saveJob } = await import("../../src/scheduled-jobs.js");

const post = async (body, { bearer = SECRET } = {}) => {
  const res = await testStateTrigger({
    method: "POST",
    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  let parsed = null; try { parsed = JSON.parse(res.body); } catch { /* text */ }
  return { status: res.statusCode, body: parsed, raw: res.body };
};

/* A real job row to hang the tombstone on. */
const job = await saveJob(
  { name: "tombstone bed", schedule: { cron: "0 9 * * *", timeZone: "UTC" }, scope: { jql: "project = LZPT" }, functions: [{ code: "api.log(1)" }] },
  { accountId: "acct-admin", savedByRole: "admin" },
);
const AGENT = job.id;

/* ═════ 1. THE GATE ═════ */
process.env.HARNESS_SECRET = "";
{
  const r = await post({ action: "vaTombstone", op: "read", agent: AGENT }, { bearer: SECRET });
  ok(r.status === 404, `with NO HARNESS_SECRET configured the whole hook is 404 (got ${r.status})`);
}
process.env.HARNESS_SECRET = SECRET;
{
  const none = await post({ action: "vaTombstone", op: "read", agent: AGENT }, { bearer: null });
  ok(none.status === 404, `no bearer -> 404, and no detail (got ${none.status} ${none.raw})`);
  const wrong = await post({ action: "vaTombstone", op: "read", agent: AGENT }, { bearer: "not-the-secret" });
  ok(wrong.status === 404, `a wrong bearer -> 404 (got ${wrong.status})`);
  ok(((await storage.get(vaPurgedKey(AGENT))) ?? null) === null, "…and neither refused call wrote anything");
}

/* ═════ 2. THE INPUT GUARDS ═════ */
{
  ok((await post({ action: "vaTombstone", op: "plant", agent: "no spaces allowed" })).status === 400, "a malformed agent id is 400");
  ok((await post({ action: "vaTombstone", op: "plant", agent: "job_not_a_real_row" })).status === 404,
    "an agent id that names no job row is 404 — the door never plants unreachable litter");
  ok((await post({ action: "vaTombstone", op: "age", agent: AGENT })).status === 409,
    "ageing a tombstone that does not exist is 409, not a silent plant");
  ok((await post({ action: "vaTombstone", op: "nonsense", agent: AGENT })).status === 400, "an unknown op is 400");
}

/* ═════ 3. PLANT — the settle-window arm ═════ */
{
  const r = await post({ action: "vaTombstone", op: "plant", agent: AGENT });
  ok(r.status === 200 && r.body.ok === true, `plant answers 200 (got ${r.status} ${r.raw.slice(0, 160)})`);
  ok(r.body.key === vaPurgedKey(AGENT), "…on the key `vaPurgedKey` builds, not a retyped string");
  const row = (await storage.get(vaPurgedKey(AGENT))) ?? null;
  ok(row && typeof row.at === "string" && row.agent === AGENT, `…and the row is the tombstone shape (got ${JSON.stringify(row)})`);
  ok(Date.parse(row.at) < Date.parse(job.createdAt),
    "…with `at` CLAMPED to before the job's createdAt, so the clear lands on the settle arm and not on tombstone_newer_than_job");
  ok(r.body.clampedToCreatedAt === true, "…and the answer says the clamp bit, so a driver grades on facts");

  const verdict = await clearPurgeTombstone(storage, AGENT, { createdAt: job.createdAt });
  ok(verdict.cleared === false && verdict.reason === "purge-settling" && verdict.settling === "window",
    `the REAL clearPurgeTombstone refuses inside the window (got ${JSON.stringify(verdict)})`);
  ok(((await storage.get(vaPurgedKey(AGENT))) ?? null) !== null, "…and the tombstone still stands");
}

/* ═════ 4. AGE — the window retires ═════ */
{
  const r = await post({ action: "vaTombstone", op: "age", agent: AGENT, ageMs: VA_PURGE_SETTLE_MS + 60000 });
  ok(r.status === 200 && r.body.effectiveAgeMs >= VA_PURGE_SETTLE_MS,
    `age moves \`at\` past the settle window (got ${JSON.stringify(r.body && r.body.effectiveAgeMs)})`);
  const verdict = await clearPurgeTombstone(storage, AGENT, { createdAt: job.createdAt });
  ok(verdict.cleared === true, `…and the REAL clearPurgeTombstone now clears (got ${JSON.stringify(verdict)})`);
  ok(((await storage.get(vaPurgedKey(AGENT))) ?? null) === null, "…the tombstone is gone");
}

/* ═════ 5. READ / CLEAR ═════ */
{
  await post({ action: "vaTombstone", op: "plant", agent: AGENT });
  const read = await post({ action: "vaTombstone", op: "read", agent: AGENT });
  ok(read.status === 200 && read.body.row && read.body.row.agent === AGENT, "read returns the planted row");
  const cleared = await post({ action: "vaTombstone", op: "clear", agent: AGENT });
  ok(cleared.status === 200 && cleared.body.row === null, "clear removes it and says so");
}

/* ═════ 6. F-632 — THE DOOR NEVER TOUCHES A REAL TOMBSTONE ═════
 * `purgeAgent` stamps `va_purged:{agent}` with NO `plantedBy`. Clearing one hands a
 * purged agent its voice back and erases the landed writes the purges panel reports;
 * ageing one retires a live settle window early. Both must refuse, and must leave the
 * row byte-for-byte where it stood — the same discipline `pipelineRow clear` shipped with.
 */
{
  const KEY = vaPurgedKey(AGENT);
  const real = { at: new Date(Date.parse(job.createdAt) - 1000).toISOString(), agent: AGENT, turns: [{ landedWrites: ["LZPT-1 comment"] }] };
  await storage.set(KEY, real);

  const cleared = await post({ action: "vaTombstone", op: "clear", agent: AGENT });
  ok(cleared.status === 409 && cleared.body.harnessRefusal === "not-planted",
    `clearing a REAL tombstone is refused not-planted (got ${cleared.status} ${cleared.raw.slice(0, 160)})`);
  ok(JSON.stringify((await storage.get(KEY)) ?? null) === JSON.stringify(real), "…and the real row is untouched");

  const aged = await post({ action: "vaTombstone", op: "age", agent: AGENT, ageMs: VA_PURGE_SETTLE_MS + 60000 });
  ok(aged.status === 409 && aged.body.harnessRefusal === "not-planted",
    `ageing a REAL tombstone is refused not-planted (got ${aged.status})`);
  ok(JSON.stringify((await storage.get(KEY)) ?? null) === JSON.stringify(real), "…and its `at` did not move, so the settle window still stands");

  const planted = await post({ action: "vaTombstone", op: "plant", agent: AGENT });
  ok(planted.status === 409 && planted.body.harnessRefusal === "not-planted", `…and a plant over it is refused too (got ${planted.status})`);

  const verdict = await clearPurgeTombstone(storage, AGENT, { createdAt: job.createdAt });
  ok(verdict.cleared === false && verdict.settling === "window",
    `the REAL clearPurgeTombstone still sees the untouched window (got ${JSON.stringify(verdict)})`);

  /* A tombstone this door DID plant is still its own to clear. */
  await storage.delete(KEY);
  await post({ action: "vaTombstone", op: "plant", agent: AGENT });
  ok(((await storage.get(KEY)) ?? {}).plantedBy === "harness", "a fresh plant stamps plantedBy:\"harness\"");
  const mine = await post({ action: "vaTombstone", op: "clear", agent: AGENT });
  ok(mine.status === 200 && mine.body.row === null, `…and the harness's own tombstone still clears (got ${mine.status})`);
}

console.log(`test-hook-va-tombstone (F-616, F-632): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
