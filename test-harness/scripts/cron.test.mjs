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
  presetToCron, cronToPreset, describeCron, normalizeTimeZone,
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
eq(normalizeTimeZone("Not/AZone"), "UTC", "unknown zone → UTC");
eq(normalizeTimeZone("Europe/Zurich"), "Europe/Zurich", "known zone kept");

console.log(`CRON: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
