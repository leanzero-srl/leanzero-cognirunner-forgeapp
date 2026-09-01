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
  let star = false;
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
  return { set, star };
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

/**
 * Next `count` firing instants strictly after `from` (ms or Date), scanning
 * minute by minute up to `maxMinutes` (default ~400 days). Returns ISO strings.
 */
export const nextRuns = (expr, { timeZone = "UTC", from = Date.now(), count = 5, maxMinutes = 60 * 24 * 400 } = {}) => {
  const spec = parseCron(expr);
  const tz = normalizeTimeZone(timeZone);
  const out = [];
  let t = floorMinute(from instanceof Date ? from.getTime() : Number(from)) + 60000;
  for (let i = 0; i < maxMinutes && out.length < count; i++, t += 60000) {
    const parts = getTimeParts(t, tz);
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
    if (cronMatchesParts(spec, parts)) out.push(new Date(t).toISOString());
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
  const out = [];
  let t = floorMinute(afterMs) + 60000;
  const end = floorMinute(untilMs);
  let guard = 0;
  while (t <= end && guard++ < 60 * 24 * 32) {
    if (cronMatchesParts(spec, getTimeParts(t, tz))) out.push(t);
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

/** Build a cron expression from a preset + options { hour, minute, days:[0-6], dom }. */
export const presetToCron = (preset, opts = {}) => {
  const h = Number.isFinite(Number(opts.hour)) ? Math.min(23, Math.max(0, parseInt(opts.hour, 10))) : 9;
  const m = Number.isFinite(Number(opts.minute)) ? Math.min(59, Math.max(0, parseInt(opts.minute, 10))) : 0;
  switch (preset) {
    case "every5": return "*/5 * * * *";
    case "every15": return "*/15 * * * *";
    case "every30": return "*/30 * * * *";
    case "hourly": return `${m} * * * *`;
    case "daily": return `${m} ${h} * * *`;
    case "weekdays": return `${m} ${h} * * 1-5`;
    case "weekly": {
      const days = Array.isArray(opts.days) && opts.days.length ? [...new Set(opts.days.map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6))].sort() : [1];
      return `${m} ${h} * * ${days.join(",")}`;
    }
    case "monthly": {
      const dom = Number.isFinite(Number(opts.dom)) ? Math.min(31, Math.max(1, parseInt(opts.dom, 10))) : 1;
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
