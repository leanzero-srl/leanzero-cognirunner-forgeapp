/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from "react";
import CustomSelect from "./CustomSelect";
import { SCHEDULE_PRESETS, presetToCron, cronToPreset, validateCron, describeCron, nextRuns, normalizeTimeZone } from "../../../../src/shared/cron.js";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FALLBACK_ZONES = ["UTC", "Europe/London", "Europe/Berlin", "Europe/Zurich", "Europe/Bucharest", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
const zoneList = () => {
  try { const z = Intl.supportedValuesOf("timeZone"); if (Array.isArray(z) && z.length) return z; } catch { /* old engines */ }
  return FALLBACK_ZONES;
};
const guessZone = () => { try { return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return "UTC"; } };

// Friendly schedule builder ⇄ cron. `value` = { cron, timeZone }; every change
// emits a valid cron (or the raw custom text so the user sees the validation error).
export default function SchedulePicker({ value, onChange, disabled = false }) {
  const cron = (value && value.cron) || "0 9 * * 1-5";
  const timeZone = (value && value.timeZone) || guessZone();
  const parsed = useMemo(() => cronToPreset(cron), [cron]);
  const [preset, setPreset] = useState(parsed.preset);
  const [customText, setCustomText] = useState(parsed.preset === "custom" ? parsed.cron : cron);
  const zones = useMemo(() => zoneList(), []);
  const hour = parsed.hour ?? 9; const minute = parsed.minute ?? 0; const days = parsed.days || [1]; const dom = parsed.dom ?? 1;
  const validity = validateCron(cron);
  const preview = useMemo(() => {
    if (!validity.ok) return [];
    try { return nextRuns(cron, { timeZone, count: 5 }); } catch { return []; }
  }, [cron, timeZone, validity.ok]);
  const fmt = (iso) => {
    try { return new Date(iso).toLocaleString(undefined, { timeZone, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
  };
  const emit = (nextPreset, opts) => {
    const next = presetToCron(nextPreset, { hour, minute, days, dom, ...opts });
    onChange({ cron: next, timeZone });
  };
  const choosePreset = (p) => {
    setPreset(p);
    if (p === "custom") { setCustomText(cron); onChange({ cron, timeZone }); } else emit(p, {});
  };
  const toggleDay = (d) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    emit("weekly", { days: next.length ? next : [d] });
  };

  return (
    <div className="schp">
      <div className="schp-row">
        <div className="schp-field schp-preset">
          <span className="label">Runs</span>
          <CustomSelect value={preset} onChange={choosePreset} options={SCHEDULE_PRESETS.map((p) => ({ value: p.id, label: p.label }))} ariaLabel="Schedule preset" disabled={disabled} />
        </div>
        {["hourly"].includes(preset) && (
          <div className="schp-field">
            <span className="label">At minute</span>
            <input type="number" min="0" max="59" value={minute} onChange={(e) => emit(preset, { minute: e.target.value })} disabled={disabled} className="schp-num" />
          </div>
        )}
        {["daily", "weekdays", "weekly", "monthly"].includes(preset) && (
          <div className="schp-field">
            <span className="label">At time</span>
            <span className="schp-time">
              <input type="number" min="0" max="23" value={hour} onChange={(e) => emit(preset, { hour: e.target.value })} disabled={disabled} className="schp-num" aria-label="Hour" />
              <span className="schp-colon">:</span>
              <input type="number" min="0" max="59" step="5" value={minute} onChange={(e) => emit(preset, { minute: e.target.value })} disabled={disabled} className="schp-num" aria-label="Minute" />
            </span>
          </div>
        )}
        {preset === "monthly" && (
          <div className="schp-field">
            <span className="label">Day of month</span>
            <input type="number" min="1" max="31" value={dom} onChange={(e) => emit(preset, { dom: e.target.value })} disabled={disabled} className="schp-num" />
          </div>
        )}
        <div className="schp-field schp-zone">
          <span className="label">Time zone</span>
          <CustomSelect value={timeZone} onChange={(tz) => onChange({ cron, timeZone: tz })} options={zones} searchable searchPlaceholder="Search zones…" ariaLabel="Time zone" disabled={disabled} />
        </div>
      </div>
      {preset === "weekly" && (
        <div className="schp-days" role="group" aria-label="Days of week">
          {DAY_LABELS.map((d, i) => (
            <button type="button" key={d} className={`schp-day ${days.includes(i) ? "on" : ""}`} onClick={() => toggleDay(i)} disabled={disabled} aria-pressed={days.includes(i)}>{d}</button>
          ))}
        </div>
      )}
      {preset === "custom" && (
        <div className="schp-custom">
          <input
            type="text" className={`schp-cron ${validity.ok ? "" : "invalid"}`} value={customText} placeholder="minute hour day month weekday — e.g. */10 8-18 * * 1-5"
            onChange={(e) => { setCustomText(e.target.value); onChange({ cron: e.target.value, timeZone }); }} disabled={disabled} aria-label="Cron expression" spellCheck={false}
          />
          <span className="hint">Standard 5-field cron. Names allowed (MON, JAN). Minimum effective granularity is 5 minutes.</span>
        </div>
      )}
      <div className={`schp-preview ${validity.ok ? "" : "schp-preview-error"}`}>
        <div className="schp-preview-head">{validity.ok ? describeCron(cron) : `Invalid schedule: ${validity.error}`}<code className="schp-preview-cron">{cron}</code></div>
        {validity.ok && preview.length > 0 && (
          <div className="schp-preview-runs">
            <span className="schp-preview-label">Next runs ({timeZone}):</span>
            {preview.map((iso) => <span key={iso} className="schp-preview-run">{fmt(iso)}</span>)}
          </div>
        )}
        {validity.ok && preview.length === 0 && <div className="schp-preview-runs"><span className="schp-preview-label">No run in the next 400 days.</span></div>}
      </div>
    </div>
  );
}
