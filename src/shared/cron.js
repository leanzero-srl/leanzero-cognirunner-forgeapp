/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Dependency-free 5-field cron (minute hour day-of-month month day-of-week)
 * with IANA time-zone support. Shared by the backend scheduler tick
 * (src/scheduled-jobs.js) and the admin-panel schedule picker (next-run
 * preview), so both agree on when a job is due.
 *
 * Supported syntax per field: `*`, `n`, `a-b`, `a,b,c`, `*\/n`, `a-b/n`,
 * month names (JAN..DEC), weekday names (SUN..SAT, 0 or 7 = Sunday), `?`
 * (treated as `*`). Standard Vixie semantics: when BOTH day-of-month and
 * day-of-week are restricted, a time matches if EITHER matches.
 *
 * Effective granularity on Forge is the scheduledTrigger interval (5 min):
 * a `* * * * *` job runs at most once per tick.
 *
 * DST — WHAT FIRES WHEN (see isWallClockAnchored below; Vixie's rule, matched):
 *   REAL-TIME schedules (the minute OR the hour field starts with `*`: `*\/15 * * * *`,
 *   `0 * * * *`, `* * * * *`) are anchored to elapsed time. EVERY instant whose local
 *   wall clock matches fires, so across a fall-back the repeated local hour fires
 *   TWICE (`0 * * * *` runs in BOTH 02:00 hours; `*\/15` keeps its 15-minute rhythm
 *   through the transition), and across a spring-forward the vanished hour simply has
 *   no instants (01:00 then 03:00 local = two consecutive real hours).
 *
 *   WALL-CLOCK schedules (both minute and hour name explicit values: `0 2 * * *`,
 *   `30 6 1 * *`) are anchored to the local clock: each distinct local
 *   YYYY-MM-DD HH:MM fires EXACTLY ONCE.
 *     · fall-back  — 02:00 exists twice; only the FIRST instant (02:00 CEST) fires,
 *       the repeat one hour later (02:00 CET) is suppressed. No double escalation.
 *     · spring-forward — 02:00 never exists; the job fires ONCE at the first instant
 *       after the gap (the transition instant, 03:00 local). No skipped day. Several
 *       matches inside one gap (`0,30 2 * * *`) collapse into that single fire.
 */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const RANGES = { minute: [0, 59], hour: [0, 23], dom: [1, 31], month: [1, 12], dow: [0, 6] };
const FIELD_ORDER = ["minute", "hour", "dom", "month", "dow"];

const nameToNum = (field, token) => {
  const t = String(token).toLowerCase();
  if (field === "month" && MONTHS[t] != null) return MONTHS[t];
  if (field === "dow" && DAYS[t] != null) return DAYS[t];
  if (!/^\d+$/.test(t)) throw new Error(`Invalid value "${token}" in the ${field} field`);
  let n = parseInt(t, 10);
  if (field === "dow" && n === 7) n = 0; // 7 = Sunday alias
  return n;
};

const parseField = (field, text) => {
  const [lo, hi] = RANGES[field];
  const set = new Set();
  const raw = String(text == null ? "" : text).trim();
  if (!raw) throw new Error(`Missing ${field} field`);
  let star = false; let starLike = false;
  for (const part of raw.split(",")) {
    const seg = part.trim();
    if (!seg) throw new Error(`Empty list item in the ${field} field`);
    const m = seg.match(/^([^/]+)(?:\/(\d+))?$/);
    if (!m) throw new Error(`Invalid token "${seg}" in the ${field} field`);
    const base = m[1].trim();
    const step = m[2] ? parseInt(m[2], 10) : 1;
    if (!(step >= 1)) throw new Error(`Invalid step "/${m[2]}" in the ${field} field`);
    let from; let to;
    if (base === "*" || base === "?") {
      from = lo; to = hi;
      starLike = true;            // `*` OR `*/n` — Vixie's MIN_STAR / HR_STAR flag
      if (step === 1) star = true;
    } else if (base.includes("-")) {
      const [a, b] = base.split("-");
      from = nameToNum(field, a); to = nameToNum(field, b);
      if (from > to) throw new Error(`Range "${base}" is reversed in the ${field} field`);
    } else {
      from = nameToNum(field, base);
      to = m[2] ? hi : from; // "5/10" = starting at 5 every 10
    }
    if (from < lo || to > hi) throw new Error(`Value out of range (${lo}-${hi}) in the ${field} field: "${seg}"`);
    for (let v = from; v <= to; v += step) set.add(v);
  }
  return { set, star, starLike };
};

/** Parse a cron expression. Throws an Error with a human message when invalid. */
export const parseCron = (expr) => {
  const text = String(expr == null ? "" : expr).trim().replace(/\s+/g, " ");
  const parts = text ? text.split(" ") : [];
  if (parts.length !== 5) throw new Error(`Expected 5 fields (minute hour day month weekday), got ${parts.length}`);
  const spec = { expr: text };
  FIELD_ORDER.forEach((f, i) => { spec[f] = parseField(f, parts[i]); });
  return spec;
};

export const validateCron = (expr) => {
  try { parseCron(expr); return { ok: true, error: null }; } catch (e) { return { ok: false, error: e.message }; }
};

// A valid IANA zone (falls back to UTC on anything the runtime doesn't know).
export const normalizeTimeZone = (tz) => {
  const z = String(tz || "").trim();
  if (!z) return "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return z; } catch { return "UTC"; }
};

const fmtCache = new Map();
const formatterFor = (tz) => {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", weekday: "short",
    }));
  }
  return fmtCache.get(tz);
};

/** Wall-clock parts of an instant in a zone: { minute, hour, dom, month, dow, year }. */
export const getTimeParts = (date, timeZone) => {
  const tz = normalizeTimeZone(timeZone);
  const d = date instanceof Date ? date : new Date(date);
  const parts = {};
  for (const p of formatterFor(tz).formatToParts(d)) parts[p.type] = p.value;
  return {
    minute: parseInt(parts.minute, 10),
    hour: parseInt(parts.hour, 10) % 24,
    dom: parseInt(parts.day, 10),
    month: parseInt(parts.month, 10),
    dow: DAYS[String(parts.weekday).toLowerCase().slice(0, 3)],
    year: parseInt(parts.year, 10),
  };
};

/** Does the parsed spec match these wall-clock parts? */
export const cronMatchesParts = (spec, parts) => {
  if (!spec.minute.set.has(parts.minute)) return false;
  if (!spec.hour.set.has(parts.hour)) return false;
  if (!spec.month.set.has(parts.month)) return false;
  const domOk = spec.dom.set.has(parts.dom);
  const dowOk = spec.dow.set.has(parts.dow);
  if (spec.dom.star && spec.dow.star) return true;
  if (spec.dom.star) return dowOk;
  if (spec.dow.star) return domOk;
  return domOk || dowOk; // Vixie: both restricted → either
};

/** Does the expression match this instant in the zone? */
export const cronMatches = (expr, date, timeZone) => cronMatchesParts(parseCron(expr), getTimeParts(date, timeZone));

const floorMinute = (ms) => Math.floor(ms / 60000) * 60000;

// ── DST (see the "WHAT FIRES WHEN" block at the top of this file) ────────────

/**
 * TRUE when the schedule names an explicit minute AND an explicit hour, i.e. it is
 * anchored to a local wall-clock time rather than to elapsed time. Mirrors Vixie's
 * MIN_STAR / HR_STAR test: any `*`-based token (`*` or `*\/n`) in the minute or the
 * hour field makes the schedule REAL-TIME (fires on every matching instant, DST or
 * not — `0 * * * *` deliberately fires in BOTH 02:00 hours of a fall-back).
 */
export const isWallClockAnchored = (spec) => !spec.minute.starLike && !spec.hour.starLike;

// Local wall-clock instant of these parts, expressed as "the same clock face in UTC".
const localAsUtc = (p) => Date.UTC(p.year, p.month - 1, p.dom, p.hour, p.minute);
// Zone offset in ms at an instant (local wall clock minus UTC), minute resolution.
const offsetAt = (t, tz) => localAsUtc(getTimeParts(t, tz)) - floorMinute(t);
// Transitions are hours apart and never shift by more than ~2h, so the offset in
// force before the most recent one is visible 1/2/3 hours back.
const BACK_PROBES_MS = [3600000, 7200000, 10800000];

/**
 * TRUE when `t` REPEATS a local wall-clock minute that already happened earlier in
 * real time (the second pass through a fall-back hour). `off` is the offset at `t`.
 * An earlier instant t-shift shares t's wall clock exactly when its offset is
 * larger by `shift`.
 */
const isRepeatedWallClock = (t, off, tz) => {
  let shift = 0;
  for (const back of BACK_PROBES_MS) { const d = offsetAt(t - back, tz) - off; if (d > shift) shift = d; }
  return shift > 0 && offsetAt(t - shift, tz) === off + shift;
};

// First minute at or before `t` (and after `prevT`) that already carries offset `off`
// — i.e. the instant the clock jumped. Binary search: ~11 probes, twice a year.
const transitionInstant = (prevT, t, off, tz) => {
  let lo = prevT; let hi = t;
  while (hi - lo > 60000) {
    const mid = floorMinute(lo + Math.floor((hi - lo) / 2));
    if (mid <= lo || mid >= hi) break;
    if (offsetAt(mid, tz) === off) hi = mid; else lo = mid;
  }
  return hi;
};

/**
 * Did a wall-clock match fall into the spring-forward gap between the previously
 * examined minute `prevT` and `t`? Only the minutes that NEVER EXISTED are tested
 * (`[transition + offsetBefore, transition + offsetAfter)`), so a schedule is never
 * credited with a minute that really happened.
 */
const gapSwallowedMatch = (spec, prevT, t, off, tz) => {
  const at = transitionInstant(prevT, t, off, tz);
  const before = offsetAt(at - 60000, tz);
  if (before >= off) return false;
  for (let wall = at + before, end = at + off, n = 0; wall < end && n < 24 * 60; wall += 60000, n++) {
    if (cronMatchesParts(spec, getTimeParts(wall, "UTC"))) return true; // wall ms read as a clock face
  }
  return false;
};

/**
 * Stable identity of ONE firing, for the scheduler's idempotency claims. A
 * wall-clock schedule is identified by its LOCAL minute, so the repeated hour of a
 * fall-back can never mint a second claim even if a caller (or a future change)
 * hands us both instants; a real-time schedule keeps the UTC instant, because its
 * two passes through a repeated hour ARE two distinct runs.
 */
export const fireIdentity = (expr, fireAt, timeZone = "UTC") => {
  const ms = floorMinute(fireAt instanceof Date ? fireAt.getTime() : Number(fireAt));
  if (!Number.isFinite(ms)) return "invalid";
  let spec = null;
  try { spec = parseCron(expr); } catch { return new Date(ms).toISOString(); }
  if (!isWallClockAnchored(spec)) return new Date(ms).toISOString();
  const tz = normalizeTimeZone(timeZone);
  const p = getTimeParts(ms, tz);
  const pad = (n) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.dom)}T${pad(p.hour)}:${pad(p.minute)}@${tz}`;
};

/**
 * Next `count` firing instants strictly after `from` (ms or Date), scanning
 * minute by minute up to `maxMinutes` (default ~400 days). Returns ISO strings.
 */
export const nextRuns = (expr, { timeZone = "UTC", from = Date.now(), count = 5, maxMinutes = 60 * 24 * 400 } = {}) => {
  const spec = parseCron(expr);
  const tz = normalizeTimeZone(timeZone);
  const wallClock = isWallClockAnchored(spec);
  const out = [];
  let t = floorMinute(from instanceof Date ? from.getTime() : Number(from)) + 60000;
  // Seed the DST bookkeeping with the minute before the first one examined, so a
  // transition landing exactly on it is still seen.
  let prevT = t - 60000; let prevOff = offsetAt(prevT, tz);
  for (let i = 0; i < maxMinutes && out.length < count; i++, t += 60000) {
    const parts = getTimeParts(t, tz);
    const off = localAsUtc(parts) - t;
    // A wall-clock match swallowed by a spring-forward gap fires HERE, at the first
    // instant after the gap. Checked before the fast skips, which jump over it.
    if (wallClock && off > prevOff && gapSwallowedMatch(spec, prevT, t, off, tz)) {
      out.push(new Date(t).toISOString()); prevT = t; prevOff = off; continue;
    }
    prevT = t; prevOff = off;
    // Fast skips: a day that can never match (month / day-of-month / weekday) jumps to
    // the next midnight; an hour that can never match jumps to the next hour.
    const dayOk = spec.month.set.has(parts.month)
      && ((spec.dom.star && spec.dow.star) || (spec.dom.star ? spec.dow.set.has(parts.dow) : spec.dow.star ? spec.dom.set.has(parts.dom) : (spec.dom.set.has(parts.dom) || spec.dow.set.has(parts.dow))));
    if (!dayOk) {
      const skip = (23 - parts.hour) * 60 + (59 - parts.minute); t += skip * 60000; i += skip; continue;
    }
    if (!spec.hour.set.has(parts.hour)) {
      const skip = 59 - parts.minute; t += skip * 60000; i += skip; continue;
    }
    // The second pass through a repeated (fall-back) hour is the SAME wall-clock run.
    if (cronMatchesParts(spec, parts) && !(wallClock && isRepeatedWallClock(t, off, tz))) out.push(new Date(t).toISOString());
  }
  return out;
};

/**
 * All firing instants in the half-open window (afterMs, untilMs] — used by the
 * scheduler tick to find what came due since the last tick. Capped to keep a
 * long outage from replaying thousands of minutes (returns the LAST `cap`).
 */
export const dueInWindow = (expr, afterMs, untilMs, timeZone = "UTC", cap = 50) => {
  const spec = parseCron(expr);
  const tz = normalizeTimeZone(timeZone);
  const wallClock = isWallClockAnchored(spec);
  const out = [];
  let t = floorMinute(afterMs) + 60000;
  const end = floorMinute(untilMs);
  let prevT = t - 60000; let prevOff = offsetAt(prevT, tz);
  let guard = 0;
  while (t <= end && guard++ < 60 * 24 * 32) {
    const parts = getTimeParts(t, tz);
    const off = localAsUtc(parts) - t;
    if (cronMatchesParts(spec, parts)) {
      // Fall-back: the repeat of an already-fired wall clock is NOT a second run.
      if (!(wallClock && isRepeatedWallClock(t, off, tz))) out.push(t);
    } else if (wallClock && off > prevOff && gapSwallowedMatch(spec, prevT, t, off, tz)) {
      // Spring-forward: a match inside the vanished hour fires once, right after it.
      out.push(t);
    }
    prevT = t; prevOff = off;
    t += 60000;
  }
  return out.length > cap ? out.slice(out.length - cap) : out;
};

// ── Presets (the UI's friendly schedule builder ⇄ cron) ──────────────────

export const SCHEDULE_PRESETS = [
  { id: "every5", label: "Every 5 minutes" },
  { id: "every15", label: "Every 15 minutes" },
  { id: "every30", label: "Every 30 minutes" },
  { id: "hourly", label: "Every hour" },
  { id: "daily", label: "Every day at…" },
  { id: "weekdays", label: "Weekdays at…" },
  { id: "weekly", label: "Weekly on…" },
  { id: "monthly", label: "Monthly on day…" },
  { id: "custom", label: "Custom cron" },
];

const two = (n) => String(n).padStart(2, "0");

/**
 * One clamped integer option, or the preset's default. An emptied number input sends
 * "" — and `Number("")` is 0 (finite!) while `parseInt("", 10)` is NaN, which is how
 * a cleared spinner used to emit the literal cron "NaN 9 * * *". Blank, non-numeric
 * and non-primitive values all fall back to the default; NaN can never be emitted.
 */
const intOpt = (value, lo, hi, fallback) => {
  if (value == null || typeof value === "boolean" || typeof value === "object") return fallback;
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
};

/** Build a cron expression from a preset + options { hour, minute, days:[0-6], dom }. */
export const presetToCron = (preset, opts = {}) => {
  const h = intOpt(opts.hour, 0, 23, 9);
  const m = intOpt(opts.minute, 0, 59, 0);
  switch (preset) {
    case "every5": return "*/5 * * * *";
    case "every15": return "*/15 * * * *";
    case "every30": return "*/30 * * * *";
    case "hourly": return `${m} * * * *`;
    case "daily": return `${m} ${h} * * *`;
    case "weekdays": return `${m} ${h} * * 1-5`;
    case "weekly": {
      // Filter FIRST: a list of blanks must fall back to Monday, not emit an empty field.
      // Out-of-range days are DROPPED, never clamped — 7 (a Sunday alias elsewhere) must
      // not silently become Saturday, which is what clamping to 0-6 would do.
      const picked = [...new Set((Array.isArray(opts.days) ? opts.days : []).map((d) => intOpt(d, -1, 7, -1)).filter((d) => d >= 0 && d <= 6))].sort();
      const days = picked.length ? picked : [1];
      return `${m} ${h} * * ${days.join(",")}`;
    }
    case "monthly": {
      const dom = intOpt(opts.dom, 1, 31, 1);
      return `${m} ${h} ${dom} * *`;
    }
    default: return String(opts.cron || "0 9 * * 1-5");
  }
};

/** Recognise a cron expression as one of the presets (for the editor). */
export const cronToPreset = (expr) => {
  const text = String(expr || "").trim().replace(/\s+/g, " ");
  let m;
  if (text === "*/5 * * * *") return { preset: "every5" };
  if (text === "*/15 * * * *") return { preset: "every15" };
  if (text === "*/30 * * * *") return { preset: "every30" };
  if ((m = text.match(/^(\d{1,2}) \* \* \* \*$/))) return { preset: "hourly", minute: +m[1] };
  if ((m = text.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/))) return { preset: "daily", minute: +m[1], hour: +m[2] };
  if ((m = text.match(/^(\d{1,2}) (\d{1,2}) \* \* 1-5$/))) return { preset: "weekdays", minute: +m[1], hour: +m[2] };
  if ((m = text.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-6](?:,[0-6])*)$/))) return { preset: "weekly", minute: +m[1], hour: +m[2], days: m[3].split(",").map(Number) };
  if ((m = text.match(/^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/))) return { preset: "monthly", minute: +m[1], hour: +m[2], dom: +m[3] };
  return { preset: "custom", cron: text };
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Human description of a cron expression ("Every day at 09:00"). */
export const describeCron = (expr) => {
  const v = validateCron(expr);
  if (!v.ok) return `Invalid schedule: ${v.error}`;
  const p = cronToPreset(expr);
  const at = (h, m) => `${two(h)}:${two(m)}`;
  switch (p.preset) {
    case "every5": return "Every 5 minutes";
    case "every15": return "Every 15 minutes";
    case "every30": return "Every 30 minutes";
    case "hourly": return p.minute === 0 ? "Every hour" : `Every hour at minute ${p.minute}`;
    case "daily": return `Every day at ${at(p.hour, p.minute)}`;
    case "weekdays": return `Weekdays at ${at(p.hour, p.minute)}`;
    case "weekly": return `Every ${p.days.map((d) => DAY_NAMES[d]).join(", ")} at ${at(p.hour, p.minute)}`;
    case "monthly": return `Monthly on day ${p.dom} at ${at(p.hour, p.minute)}`;
    default: {
      const s = parseCron(expr);
      if (s.minute.set.size === 60 && s.hour.star) return "Every minute (runs once per 5-minute tick)";
      const step = s.expr.split(" ")[0].match(/^\*\/(\d+)$/);
      if (step && s.hour.star && s.dom.star && s.month.star && s.dow.star) return `Every ${step[1]} minutes`;
      return `Custom: ${s.expr}`;
    }
  }
};
