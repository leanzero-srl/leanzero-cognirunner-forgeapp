/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/cron.js — the scheduler's ONLY notion of time.
// Run: node scripts/cron.test.mjs
import {
  parseCron, validateCron, cronMatches, nextRuns, dueInWindow, getTimeParts,
  presetToCron, cronToPreset, describeCron, normalizeTimeZone, fireIdentity, isWallClockAnchored,
} from "../../src/shared/cron.js";

let pass = 0; let fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("  FAIL:", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

// parse / validate
ok(validateCron("*/5 * * * *").ok, "*/5 valid");
ok(validateCron("0 9 * * 1-5").ok, "weekdays valid");
ok(validateCron("0 9 * * MON,WED,FRI").ok, "day names valid");
ok(validateCron("30 6 1 JAN,JUL *").ok, "month names valid");
ok(!validateCron("* * * *").ok, "4 fields invalid");
ok(!validateCron("60 * * * *").ok, "minute 60 invalid");
ok(!validateCron("0 24 * * *").ok, "hour 24 invalid");
ok(!validateCron("0 0 0 * *").ok, "dom 0 invalid");
ok(!validateCron("0 0 * 13 *").ok, "month 13 invalid");
ok(!validateCron("5-1 * * * *").ok, "reversed range invalid");
ok(!validateCron("").ok, "empty invalid");
ok(!validateCron("a b c d e").ok, "garbage invalid");
eq([...parseCron("0 9 * * 7").dow.set], [0], "7 = Sunday");
eq([...parseCron("5/20 * * * *").minute.set], [5, 25, 45], "start/step");
eq([...parseCron("1-10/3 * * * *").minute.set], [1, 4, 7, 10], "range/step");

// matching in a zone (2026-03-09 is a Monday)
const utc = Date.UTC(2026, 2, 9, 9, 0); // 09:00Z Monday
ok(cronMatches("0 9 * * 1", utc, "UTC"), "Monday 09:00 UTC matches");
ok(!cronMatches("0 9 * * 2", utc, "UTC"), "Tuesday spec does not match Monday");
ok(cronMatches("0 10 * * 1", utc, "Europe/Zurich"), "09:00Z = 10:00 Zurich (CET)");
ok(cronMatches("0 5 * * 1", utc, "America/New_York"), "09:00Z = 05:00 New York (EDT — US DST began 2026-03-08)");
const dst = Date.UTC(2026, 6, 6, 8, 0); // July: CEST = UTC+2
ok(cronMatches("0 10 * * 1", dst, "Europe/Zurich"), "DST-aware: 08:00Z = 10:00 Zurich (CEST)");
eq(getTimeParts(Date.UTC(2026, 0, 1, 0, 30), "UTC").hour, 0, "midnight hour is 0 (h23)");
eq(getTimeParts(Date.UTC(2026, 0, 1, 0, 30), "UTC").dow, 4, "2026-01-01 is a Thursday");

// dom/dow OR semantics
ok(cronMatches("0 0 15 * 1", Date.UTC(2026, 0, 15, 0, 0), "UTC"), "dom matches even though dow does not (Vixie OR)");
ok(cronMatches("0 0 15 * 1", Date.UTC(2026, 0, 12, 0, 0), "UTC"), "dow matches even though dom does not");
ok(!cronMatches("0 0 15 * 1", Date.UTC(2026, 0, 13, 0, 0), "UTC"), "neither matches");

// nextRuns
const from = Date.UTC(2026, 2, 9, 9, 3);
eq(nextRuns("*/5 * * * *", { timeZone: "UTC", from, count: 3 }), ["2026-03-09T09:05:00.000Z", "2026-03-09T09:10:00.000Z", "2026-03-09T09:15:00.000Z"], "next three 5-minute slots");
eq(nextRuns("0 9 * * 1-5", { timeZone: "UTC", from, count: 2 }), ["2026-03-10T09:00:00.000Z", "2026-03-11T09:00:00.000Z"], "weekday 09:00 skips today (already past)");
eq(nextRuns("0 9 * * 6", { timeZone: "UTC", from, count: 1 }), ["2026-03-14T09:00:00.000Z"], "next Saturday");
eq(nextRuns("0 0 29 2 *", { timeZone: "UTC", from, count: 1 }), [], "Feb 29 is beyond the default 400-day horizon");
eq(nextRuns("0 0 29 2 *", { timeZone: "UTC", from, count: 1, maxMinutes: 60 * 24 * 800 }), ["2028-02-29T00:00:00.000Z"], "Feb 29 finds the leap year with a longer horizon");
eq(nextRuns("0 10 * * *", { timeZone: "Europe/Zurich", from, count: 1 }), ["2026-03-10T09:00:00.000Z"], "10:00 Zurich = 09:00Z next day");

// dueInWindow — the scheduler's core question
const t0 = Date.UTC(2026, 2, 9, 9, 3, 20);
const t1 = Date.UTC(2026, 2, 9, 9, 8, 40);
eq(dueInWindow("*/5 * * * *", t0, t1, "UTC"), [Date.UTC(2026, 2, 9, 9, 5)], "one 5-minute slot in (09:03:20, 09:08:40]");
eq(dueInWindow("* * * * *", t0, t1, "UTC").length, 5, "five minutes in the window");
eq(dueInWindow("0 9 * * *", t0, t1, "UTC"), [], "09:00 not in window (window starts after)");
eq(dueInWindow("0 9 * * *", Date.UTC(2026, 2, 9, 8, 59), t1, "UTC"), [Date.UTC(2026, 2, 9, 9, 0)], "09:00 inside window");
eq(dueInWindow("* * * * *", 0, 1e13, "UTC", 3).length, 3, "cap returns the last N only (guarded loop)");

// ── DST: a wall-clock schedule fires ONCE per local minute; a real-time one keeps
// real time. Berlin 2026: fall-back 25 Oct (03:00 CEST → 02:00 CET, at 01:00Z),
// spring-forward 29 Mar (02:00 CET → 03:00 CEST, at 01:00Z). New York 2026:
// fall-back 1 Nov (at 06:00Z), spring-forward 8 Mar (at 07:00Z).
const iso = (list) => list.map((t) => new Date(t).toISOString());
const BER = "Europe/Berlin"; const NYC = "America/New_York";
ok(isWallClockAnchored(parseCron("0 2 * * *")), "explicit minute+hour = wall-clock anchored");
ok(!isWallClockAnchored(parseCron("0 * * * *")), "star hour = real-time (fires in both fall-back hours)");
ok(!isWallClockAnchored(parseCron("*/15 * * * *")), "star minute = real-time");
ok(!isWallClockAnchored(parseCron("*/15 2 * * *")), "stepped minute in a fixed hour is still real-time");

// fall-back: the repeated 02:00 must NOT produce a second run
eq(iso(dueInWindow("0 2 * * *", Date.UTC(2026, 9, 24, 21, 0), Date.UTC(2026, 9, 25, 4, 0), BER)),
  ["2026-10-25T00:00:00.000Z"], "Berlin fall-back: daily 02:00 fires once (02:00 CEST), not twice");
// spring-forward: 02:00 does not exist — fire at the first instant after the gap
eq(iso(dueInWindow("0 2 * * *", Date.UTC(2026, 2, 28, 21, 0), Date.UTC(2026, 2, 29, 4, 0), BER)),
  ["2026-03-29T01:00:00.000Z"], "Berlin spring-forward: daily 02:00 fires at 03:00 local, never skipped");
eq(iso(dueInWindow("0,30 2 * * *", Date.UTC(2026, 2, 28, 21, 0), Date.UTC(2026, 2, 29, 4, 0), BER)),
  ["2026-03-29T01:00:00.000Z"], "several matches inside one gap collapse into a single fire");
eq(iso(dueInWindow("30 1 * * *", Date.UTC(2026, 10, 1, 3, 0), Date.UTC(2026, 10, 1, 9, 0), NYC)),
  ["2026-11-01T05:30:00.000Z"], "New York fall-back: daily 01:30 fires once (EDT)");
eq(iso(dueInWindow("30 2 * * *", Date.UTC(2026, 2, 8, 3, 0), Date.UTC(2026, 2, 8, 9, 0), NYC)),
  ["2026-03-08T07:00:00.000Z"], "New York spring-forward: daily 02:30 fires at the transition instant");
// non-DST controls: real-time schedules keep firing on elapsed time
eq(dueInWindow("*/15 * * * *", Date.UTC(2026, 9, 25, 0, 0), Date.UTC(2026, 9, 25, 2, 0), BER).length, 8,
  "every 15 minutes stays every 15 minutes of REAL time across the fall-back");
eq(dueInWindow("*/15 * * * *", Date.UTC(2026, 10, 1, 4, 30), Date.UTC(2026, 10, 1, 6, 30), NYC).length, 8,
  "every 15 minutes across the New York fall-back");
eq(iso(dueInWindow("0 * * * *", Date.UTC(2026, 9, 24, 23, 0), Date.UTC(2026, 9, 25, 3, 0), BER)),
  ["2026-10-25T00:00:00.000Z", "2026-10-25T01:00:00.000Z", "2026-10-25T02:00:00.000Z", "2026-10-25T03:00:00.000Z"],
  "hourly fires in BOTH 02:00 hours (Vixie: an hour-star schedule is not deduped)");
eq(dueInWindow("0 2 * * *", Date.UTC(2026, 6, 5, 21, 0), Date.UTC(2026, 6, 6, 4, 0), BER).length, 1, "an ordinary day is unaffected");
// the preview the editor shows must agree with the scheduler
eq(nextRuns("0 2 * * *", { timeZone: BER, from: Date.UTC(2026, 9, 24, 12, 0), count: 3 }),
  ["2026-10-25T00:00:00.000Z", "2026-10-26T01:00:00.000Z", "2026-10-27T01:00:00.000Z"], "preview shows one run on the fall-back day");
eq(nextRuns("0 2 * * *", { timeZone: BER, from: Date.UTC(2026, 2, 28, 12, 0), count: 2 }),
  ["2026-03-29T01:00:00.000Z", "2026-03-30T00:00:00.000Z"], "preview keeps the spring-forward day instead of skipping it");
// claim identity: the two instants of a repeated hour are ONE firing
eq(fireIdentity("0 2 * * *", Date.UTC(2026, 9, 25, 0, 0), BER), fireIdentity("0 2 * * *", Date.UTC(2026, 9, 25, 1, 0), BER),
  "a wall-clock firing is identified by its LOCAL minute, so the repeat cannot mint a second claim");
eq(fireIdentity("0 2 * * *", Date.UTC(2026, 9, 25, 0, 0), BER), "2026-10-25T02:00@Europe/Berlin", "wall-clock identity format");
ok(fireIdentity("0 * * * *", Date.UTC(2026, 9, 25, 0, 0), BER) !== fireIdentity("0 * * * *", Date.UTC(2026, 9, 25, 1, 0), BER),
  "a real-time firing keeps the UTC instant, so both fall-back hours run");
eq(fireIdentity("*/5 * * * *", Date.UTC(2026, 9, 25, 1, 0), BER), "2026-10-25T01:00:00.000Z", "real-time identity is the instant");
eq(fireIdentity("nonsense", Date.UTC(2026, 9, 25, 1, 0), BER), "2026-10-25T01:00:00.000Z", "an unparsable expression falls back to the instant");

// presets round-trip
eq(presetToCron("daily", { hour: 7, minute: 30 }), "30 7 * * *", "daily preset");
eq(presetToCron("weekly", { hour: 9, minute: 0, days: [5, 1] }), "0 9 * * 1,5", "weekly preset sorts days");
eq(presetToCron("monthly", { hour: 0, minute: 0, dom: 31 }), "0 0 31 * *", "monthly preset");
eq(presetToCron("weekdays", { hour: 9, minute: 15 }), "15 9 * * 1-5", "weekdays preset");
eq(cronToPreset("30 7 * * *"), { preset: "daily", minute: 30, hour: 7 }, "daily recognised");
eq(cronToPreset("0 9 * * 1,5"), { preset: "weekly", minute: 0, hour: 9, days: [1, 5] }, "weekly recognised");
eq(cronToPreset("*/7 * * * *"), { preset: "custom", cron: "*/7 * * * *" }, "custom recognised");
eq(describeCron("0 9 * * 1-5"), "Weekdays at 09:00", "describe weekdays");
eq(describeCron("*/5 * * * *"), "Every 5 minutes", "describe every5");
eq(describeCron("*/7 * * * *"), "Every 7 minutes", "describe custom step");
eq(describeCron("0 9 * * 1,3"), "Every Monday, Wednesday at 09:00", "describe weekly");
ok(describeCron("bad").startsWith("Invalid schedule"), "describe invalid");
// a cleared number input sends "" — Number("") is 0 but parseInt("") is NaN, which
// used to be emitted verbatim into the cron string
eq(presetToCron("daily", { hour: 9, minute: "" }), "0 9 * * *", "empty minute falls back to 0, never NaN");
eq(presetToCron("monthly", { minute: 0, hour: "", dom: "  " }), "0 9 1 * *", "empty hour and day-of-month fall back");
eq(presetToCron("hourly", { minute: "" }), "0 * * * *", "empty minute on hourly");
eq(presetToCron("weekly", { hour: 9, minute: 0, days: ["", null] }), "0 9 * * 1", "a list of blank days falls back to Monday, not an empty field");
for (const [preset, opts] of [["daily", { hour: 9, minute: "" }], ["monthly", { minute: 0, hour: "", dom: "" }], ["weekly", { hour: "", minute: "", days: [""] }], ["hourly", { minute: "abc" }], ["weekdays", { hour: null, minute: undefined }]]) {
  const expr = presetToCron(preset, opts);
  ok(!/NaN/.test(expr), `${preset} never emits NaN (got "${expr}")`);
  ok(validateCron(expr).ok, `${preset} with blank options is still a valid cron (got "${expr}")`);
}
ok(!validateCron("NaN 9 * * *").ok, "a NaN cron is rejected if one ever reaches validation");

eq(normalizeTimeZone("Not/AZone"), "UTC", "unknown zone → UTC");
eq(normalizeTimeZone("Europe/Zurich"), "Europe/Zurich", "known zone kept");

console.log(`CRON: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
