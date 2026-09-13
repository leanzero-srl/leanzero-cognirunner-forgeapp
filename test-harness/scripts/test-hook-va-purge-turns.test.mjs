/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-628 — THE PURGED-TURN WRITES, AND THE ONE WRITER THAT MAY PRODUCE THEM.
 *
 * F-608's "recently deleted agents that wrote during deletion" panel returns a row ONLY
 * when `turns[].landedWrites` is non-empty, and the sole producer of that field is
 * `recordPurgedTurnWrites` running inside a turn that is writing to Jira at the moment the
 * agent is deleted — a race no driver can schedule. So the panel could only ever be proven
 * EMPTY live, and an empty list is not evidence that a populated one would render.
 *
 * `vaTombstone plant` now accepts a bounded `turns` array. What this suite proves:
 *  · THE SAME WRITER, NEVER A SECOND ONE. The hook calls `recordPurgedTurnWrites` once per
 *    turn; the row it leaves is asserted to be exactly what `listRecentPurges` — the
 *    tab-facing projection — projects, so the panel is proven against the ENGINE's shape
 *    and not against the harness's idea of it;
 *  · IT IS 404 WITHOUT THE SECRET, on every arm, with nothing written;
 *  · A SECRET IS NEVER PLANTABLE: a body naming a token or an api key, at the top level or
 *    inside a turn, is refused BEFORE the tombstone is read or written;
 *  · EVERY BOUND IS CLAMPED SERVER-SIDE: five turns, five writes each, 64 characters per
 *    write, `at` inside the last seven days and never in the future;
 *  · `age` PRESERVES the turns it moves — a rewrite of the row that dropped the carrier
 *    would erase the very thing the door exists to plant.
 *
 * Run: node scripts/test-hook-va-purge-turns.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

forgeApi.__respond(() => forgeApi.__response(200, {}));

const SECRET = "harness-secret-628";
const { testStateTrigger } = await import("../../src/test-hook.js");
const { vaPurgedKey } = await import("../../src/shared/va-keys.js");
const { listRecentPurges } = await import("../../src/va-admin.js");
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

const job = await saveJob(
  { name: "purge-turns bed", schedule: { cron: "0 9 * * *", timeZone: "UTC" }, scope: { jql: "project = LZPT" }, functions: [{ code: "api.log(1)" }] },
  { accountId: "acct-admin", savedByRole: "admin" },
);
const AGENT = job.id;
const KEY = vaPurgedKey(AGENT);
const plant = (extra = {}) => post({ action: "vaTombstone", op: "plant", agent: AGENT, ...extra });
const clear = () => post({ action: "vaTombstone", op: "clear", agent: AGENT });
const rawRow = async () => (await storage.get(KEY)) ?? null;

/* ═════ 1. THE GATE — a plant CARRYING TURNS is refused just as hard ═════ */
process.env.HARNESS_SECRET = "";
{
  const r = await plant({ turns: [{ issueKey: "SUP-1", writes: ["add_comment SUP-1"] }] });
  ok(r.status === 404, `with NO HARNESS_SECRET configured the whole hook is 404 (got ${r.status})`);
}
process.env.HARNESS_SECRET = SECRET;
{
  const none = await post({ action: "vaTombstone", op: "plant", agent: AGENT, turns: [{ writes: ["x"] }] }, { bearer: null });
  ok(none.status === 404, `no bearer -> 404 (got ${none.status})`);
  const wrong = await post({ action: "vaTombstone", op: "plant", agent: AGENT, turns: [{ writes: ["x"] }] }, { bearer: "not-the-secret" });
  ok(wrong.status === 404, `a wrong bearer -> 404 (got ${wrong.status})`);
  ok((await rawRow()) === null, "…and neither refused call wrote a tombstone");
}

/* ═════ 2. A SECRET IS NEVER PLANTABLE ═════ */
{
  const cases = [
    ["a top-level token", { token: "ghp_abcdefgh12345678", turns: [{ writes: ["add_comment SUP-1"] }] }],
    ["an apiKey", { apiKey: "x", turns: [{ writes: ["add_comment SUP-1"] }] }],
    ["a credential named INSIDE a turn", { turns: [{ writes: ["add_comment SUP-1"], token: "x" }] }],
    ["a COGNIRUNNER_KEY_* value in a write string", { turns: [{ writes: ["COGNIRUNNER_KEY_openai"] }] }],
  ];
  for (const [what, extra] of cases) {
    const r = await plant(extra);
    ok(r.status === 400 && r.body && r.body.harnessRefusal === "secret-field",
      `a plant carrying ${what} is refused secret-field (got ${r.status} ${r.raw.slice(0, 140)})`);
  }
  ok((await rawRow()) === null, "…and not one of those refusals wrote a tombstone — the check is BEFORE the side effect");
}

/* ═════ 3. THE TURN GUARDS ═════ */
{
  ok((await plant({ turns: "nope" })).status === 400, "a non-array `turns` is 400");
  ok((await plant({ turns: [{ writes: [] }] })).status === 400, "a turn with no writes is 400 — an empty note is not a purge worth showing");
  ok((await plant({ turns: [{ issueKey: "not an issue key", writes: ["x"] }] })).status === 400, "a malformed turn issueKey is 400");
  ok((await plant({ turns: ["not an object"] })).status === 400, "a non-object turn is 400");
}

/* ═════ 4. THE PLANT — and the PRODUCT's projection of it ═════ */
{
  await clear();
  const r = await plant({
    turns: [
      { at: new Date(Date.now() - 120000).toISOString(), issueKey: "SUP-1", writes: ["add_comment SUP-1", "transition SUP-1 -> Done"] },
      { at: new Date(Date.now() - 60000).toISOString(), issueKey: "SUP-2", writes: ["add_comment SUP-2"] },
    ],
  });
  ok(r.status === 200 && r.body.ok === true, `a plant with turns answers 200 (got ${r.status} ${r.raw.slice(0, 200)})`);
  ok(Array.isArray(r.body.noted) && r.body.noted.length === 2 && r.body.noted.every((n) => n.ok === true),
    `…and reports the PRODUCT writer's own answer per turn (got ${JSON.stringify(r.body.noted)})`);

  const row = await rawRow();
  ok(Array.isArray(row.turns) && row.turns.length === 2, `the tombstone carries two turns (got ${row.turns && row.turns.length})`);
  ok(row.turns[0].landedWrites.length === 2 && row.turns[1].landedWrites.length === 1,
    "…with the writes the driver named, under the field name the ENGINE writes (`landedWrites`)");
  ok(row.at && row.agent === AGENT && row.plantedBy === "harness", "…and the tombstone itself is unchanged in shape");

  // THE POINT OF THE WHOLE DOOR: the tab-facing projection sees it.
  const projected = await listRecentPurges({}, { store: storage });
  ok(projected.ok === true, `listRecentPurges answers ok (got ${JSON.stringify(projected).slice(0, 200)})`);
  const mine = (projected.purges || []).find((p) => p.agent === AGENT);
  ok(Boolean(mine), "…and RETURNS this agent — the one sentence F-608's panel exists to print, from real engine data");
  ok(mine && mine.writeCount === 3, `…with the write count the panel shows (got ${mine && mine.writeCount})`);
  ok(mine && mine.turns.length === 2 && mine.turns[0].writes.includes("add_comment SUP-1") && mine.turns[0].issueKey === "SUP-1",
    `…and the per-turn issue key and write strings (got ${JSON.stringify(mine && mine.turns).slice(0, 200)})`);
  ok(mine && typeof mine.purgedAt === "string", "…and the purge time the panel dates the row by");
}

/* ═════ 5. THE CLAMPS ═════ */
{
  await clear();
  const many = Array.from({ length: 9 }, (_, i) => ({ issueKey: `SUP-${i + 1}`, writes: Array.from({ length: 9 }, (_, j) => `write_${i}_${j}`) }));
  const r = await plant({ turns: many });
  ok(r.status === 200 && r.body.noted.length === 5, `nine turns are clamped to five (got ${r.body.noted && r.body.noted.length})`);
  const row = await rawRow();
  ok(row.turns.length === 5, `…and five land on the row (got ${row.turns.length})`);
  ok(row.turns.every((t) => t.landedWrites.length === 5), `…each with nine writes clamped to five (got ${JSON.stringify(row.turns.map((t) => t.landedWrites.length))})`);

  await clear();
  const long = "W".repeat(500);
  await plant({ turns: [{ writes: [long] }] });
  ok((await rawRow()).turns[0].landedWrites[0].length === 64, `a 500-character write string is clamped to 64 (got ${(await rawRow()).turns[0].landedWrites[0].length})`);

  await clear();
  await plant({ turns: [{ at: "2099-01-01T00:00:00.000Z", writes: ["future write"] }] });
  ok(Date.parse((await rawRow()).turns[0].at) <= Date.now() + 5000, "a turn `at` in the future is clamped to now — the panel never dates a purge ahead of the clock");

  await clear();
  await plant({ turns: [{ at: "1999-01-01T00:00:00.000Z", writes: ["ancient write"] }] });
  ok(Date.now() - Date.parse((await rawRow()).turns[0].at) <= 7 * 24 * 3600 * 1000 + 5000, "a turn `at` older than seven days is clamped forward");

  await clear();
  await plant({ turns: [{ at: "not a date", writes: ["undated write"] }] });
  ok(Number.isFinite(Date.parse((await rawRow()).turns[0].at)), "an unparseable `at` becomes now, never NaN on the row");
}

/* ═════ 6. AGE PRESERVES THE CARRIER ═════ */
{
  await clear();
  await plant({ turns: [{ issueKey: "SUP-9", writes: ["add_comment SUP-9"] }] });
  const aged = await post({ action: "vaTombstone", op: "age", agent: AGENT, ageMs: 10 * 60 * 1000 });
  ok(aged.status === 200, `age answers 200 (got ${aged.status})`);
  const row = await rawRow();
  ok(Array.isArray(row.turns) && row.turns.length === 1 && row.turns[0].landedWrites[0] === "add_comment SUP-9",
    `…and the turns SURVIVE the rewrite (got ${JSON.stringify(row.turns)})`);
  const projected = await listRecentPurges({}, { store: storage });
  ok((projected.purges || []).some((p) => p.agent === AGENT), "…so the panel still shows the agent after an age");
}

/* ═════ 7. A PLANT WITHOUT TURNS IS UNCHANGED, AND THE PANEL IGNORES IT ═════ */
{
  await clear();
  const r = await plant({});
  ok(r.status === 200 && r.body.noted === undefined, "a plant with no `turns` answers exactly as before — no `noted`, no behaviour change for F-616's driver");
  ok(!Object.prototype.hasOwnProperty.call(await rawRow(), "turns"), "…and writes no turns field at all");
  const projected = await listRecentPurges({}, { store: storage });
  ok(!(projected.purges || []).some((p) => p.agent === AGENT),
    "…so the panel does NOT list it: a purge with no writes behind it is honestly uneventful");
}

/* ═════ 8. CLEAR ═════ */
{
  await plant({ turns: [{ writes: ["add_comment SUP-1"] }] });
  const cleared = await clear();
  ok(cleared.status === 200 && cleared.body.row === null, "clear removes the tombstone and its turns");
  const projected = await listRecentPurges({}, { store: storage });
  ok(!(projected.purges || []).some((p) => p.agent === AGENT), "…and the panel is empty of this agent again — the second read that proves the first one");
}

console.log(`test-hook-va-purge-turns (F-628): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
