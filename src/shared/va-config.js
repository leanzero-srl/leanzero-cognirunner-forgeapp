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
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE VIRTUAL ADMINISTRATOR RECORD — shape, clamps and the ONE renderer of its
 * guardrail sentences (release 1.5, commit 1).
 *
 * A Virtual Administrator is NOT a new kind of rule: it is a scheduled job with
 * `mode:"va"`, so it reuses the job index, the 5-minute tick planner, the tick claim,
 * run-now and the Rules REST API. `normalizeVa` is therefore called FROM INSIDE
 * `normalizeJob`'s `mode:"va"` arm (src/scheduled-jobs.js, commit 3) — it never becomes
 * a parallel save path, because a second store is exactly how the two records start
 * disagreeing about what an agent is allowed to do.
 *
 * WHY THIS FILE EXISTS AT ALL (LAW 1). The same numbers are read by three consumers
 * that cannot import each other: the save path, the engine's gates and the admin
 * panel's wizard review card. This module bundles into the backend AND the UI builds,
 * so the wizard cannot promise a cap the engine does not hold.
 *
 * DEPENDENCY-FREE, like every `src/shared/*` module: no `@forge/*`, no node built-ins,
 * only relative imports of other shared modules. In particular it does NOT import
 * `src/memories.js` (which pulls in `@forge/kvs` at load) — any text that reaches a
 * prompt is DEFANGED BY THE CALLER before it gets here.
 *
 * WHERE THE NUMBERS LIVE. Every number a runtime GATE enforces is declared once in
 * `src/shared/registry-limits.js`, beside the job and agent-run brakes and next to its
 * refusal sentence (`vaRefusalText`); this file imports them and exposes them as
 * `VA_LIMITS`. The numbers declared HERE are only the RECORD'S SHAPE bounds — string
 * lengths, list lengths, the persona charset — because nothing outside `normalizeVa`
 * ever reads them. `shared-imports.test.mjs` asserts this file re-declares none of the
 * brake literals, so the split cannot rot into two homes.
 *
 * FAIL CONTRACT (LAW 3) — `normalizeVa` fails CLOSED.
 *   - A structural refusal THROWS: no name, a site-wide WRITE scope, an invalid or
 *     absent cadence. A throw is the save path's refusal: the record never lands.
 *   - Everything else is clamped TOWARD THE RESTRICTIVE END and reported in `refused[]`
 *     with the field name and a sentence the admin UI shows verbatim. A clamp that is
 *     not reported is a silent permission change, which is the defect this contract
 *     exists to prevent — so `refused[]` is part of the return value, not a log line.
 *   - It never clamps toward the permissive end: an unparseable cap becomes the
 *     DEFAULT, never the maximum.
 *
 * WHAT THIS MODULE DOES NOT DO. It does no I/O, so it cannot ask Jira whether a project
 * key, a service desk, a queue or a JQL string is real. The caller (the resolver) fetches
 * those and passes them in as `{projects, serviceDesks, timeZones, skillIndex}`. In
 * particular `intake.jql` is passed through AS A STRING ONLY: it is length-clamped and
 * type-checked here, and it is VALIDATED BY A DRY `search` BOUNDED TO ONE RESULT IN THE
 * RESOLVER (F-424). A JQL that cannot be executed must never become standing intake, and
 * a pure module cannot prove that.
 */

import {
  VA_CAPS_PER_HOUR_DEFAULT, VA_CAPS_PER_HOUR_MAX,
  VA_CAPS_PER_DAY_DEFAULT, VA_CAPS_PER_DAY_MAX,
  VA_OWED_PER_HOUR_DEFAULT, VA_OWED_PER_HOUR_MAX,
  VA_MAX_ITEMS_PER_TICK_DEFAULT, VA_MAX_ITEMS_PER_TICK_MAX,
  VA_MAX_CANDIDATES_PER_TICK,
  VA_SHADOW_TICKS_DEFAULT, VA_SHADOW_TICKS_MAX,
  VA_MIN_POST_GAP_MINUTES_DEFAULT, VA_MIN_POST_GAP_MINUTES_MIN, VA_MIN_POST_GAP_MINUTES_MAX,
  VA_ANTI_PILE_UP_DAYS_DEFAULT, VA_ANTI_PILE_UP_DAYS_MAX,
  VA_OTHER_WRITER_QUIET_MINUTES_DEFAULT, VA_OTHER_WRITER_QUIET_MINUTES_MAX,
  VA_ITEM_ATTEMPTS_MAX, VA_ITEM_ROW_CAP, VA_ITEM_TTL_DAYS, VA_TICK_TTL_DAYS, VA_EFFECT_TTL_DAYS,
  VA_WIZARD_TTL_DAYS,
  VA_HISTORY_MAX, VA_NOTES_MAX_CHARS, VA_STAGED_BODY_MAX_CHARS,
  VA_CONSTRAINTS_MAX, VA_CONSTRAINT_MAX_CHARS,
  VA_MEMORY_COMPACT_BYTES, VA_MEMORY_MAX_BYTES,
  VA_HEALTH_BANNER_FAILED_TICKS,
  JOB_DEFAULT_MAX_WRITES_PER_RUN, JOB_MAX_WRITES_PER_RUN, JOB_MIN_WRITES_PER_RUN,
  MAX_RULE_SKILL_IDS,
} from "./registry-limits.js";
import { SCHEDULE_PRESETS, presetToCron, cronToPreset, validateCron, normalizeTimeZone } from "./cron.js";
import { clampChars } from "./text-clamp.js";

/**
 * EVERY VA NUMBER, FLAT, IN ONE FROZEN VIEW — the caps, the TTLs and the row bounds the
 * engine (`src/virtual-admin.js`) and the ledger (`src/va-ledger.js`) clamp against, plus
 * what the wizard renders and the REST answer reports.
 *
 * The literals live in `registry-limits.js`; this is a VIEW, not a second declaration.
 * Flat scalars on purpose: the ledger writes `clamp(x, VA_LIMITS.historyMax)`, and a
 * member that is sometimes a number and sometimes an object is how a clamp becomes NaN.
 * The AUTHOR-RAISABLE CEILINGS (the "how high may this be set" half) are the separate
 * `VA_CEILINGS` below, because only `normalizeVa` reads them.
 *
 * `src/shared/va-keys.js` owns the KVS `{ttl:{value,unit}}` option SHAPES and imports the
 * day counts from here — the shapes live beside the keys they belong to, the numbers live
 * here, and neither file retypes the other's half.
 */
export const VA_LIMITS = Object.freeze({
  /* speech caps (F-412) — `owedPerHour` is its own counter; `owedUncapped` does not exist */
  capsPerHour: VA_CAPS_PER_HOUR_DEFAULT,
  capsPerDay: VA_CAPS_PER_DAY_DEFAULT,
  owedPerHour: VA_OWED_PER_HOUR_DEFAULT,
  /* the tick and the two-phase speech floor */
  maxItemsPerTick: VA_MAX_ITEMS_PER_TICK_DEFAULT,
  maxCandidatesPerTick: VA_MAX_CANDIDATES_PER_TICK,
  shadowTicks: VA_SHADOW_TICKS_DEFAULT,
  minPostGapMinutes: VA_MIN_POST_GAP_MINUTES_DEFAULT,
  antiPileUpDays: VA_ANTI_PILE_UP_DAYS_DEFAULT,
  otherWriterQuietMinutes: VA_OTHER_WRITER_QUIET_MINUTES_DEFAULT,
  /* ONE write vocabulary with the job brake (F-425). There is no maxBulkTargets. */
  maxWritesPerRun: JOB_DEFAULT_MAX_WRITES_PER_RUN,
  /* ledger rows (F-413/F-414) */
  attemptsCap: VA_ITEM_ATTEMPTS_MAX,
  itemRowCap: VA_ITEM_ROW_CAP,
  itemTtlDays: VA_ITEM_TTL_DAYS,
  tickTtlDays: VA_TICK_TTL_DAYS,
  effectTtlDays: VA_EFFECT_TTL_DAYS,
  /* how long a half-finished setup interview is kept (1.5 commit 5b) */
  wizardTtlDays: VA_WIZARD_TTL_DAYS,
  historyMax: VA_HISTORY_MAX,
  notesMaxChars: VA_NOTES_MAX_CHARS,
  stagedBodyMaxChars: VA_STAGED_BODY_MAX_CHARS,
  /* agent memory (F-423) */
  memoryCompactBytes: VA_MEMORY_COMPACT_BYTES,
  memoryCapBytes: VA_MEMORY_MAX_BYTES,
  constraintsMax: VA_CONSTRAINTS_MAX,
  constraintMaxChars: VA_CONSTRAINT_MAX_CHARS,
  /* health banner (F-426) and the knowledge binding */
  healthBannerFailedTicks: VA_HEALTH_BANNER_FAILED_TICKS,
  skillIds: MAX_RULE_SKILL_IDS,
});

/**
 * How high (and how low) an author may set each cap. Read by `normalizeVa` and rendered
 * by the wizard so a spinner cannot offer a value the save path will clamp away.
 */
export const VA_CEILINGS = Object.freeze({
  capsPerHour: Object.freeze({ min: 0, max: VA_CAPS_PER_HOUR_MAX }),
  capsPerDay: Object.freeze({ min: 0, max: VA_CAPS_PER_DAY_MAX }),
  owedPerHour: Object.freeze({ min: 0, max: VA_OWED_PER_HOUR_MAX }),
  maxItemsPerTick: Object.freeze({ min: 1, max: VA_MAX_ITEMS_PER_TICK_MAX }),
  shadowTicks: Object.freeze({ min: 0, max: VA_SHADOW_TICKS_MAX }),
  // The post gap has a FLOOR as well as a ceiling: the wall-clock half of the speech
  // floor is the gate, so it cannot be set to zero and disabled.
  minPostGapMinutes: Object.freeze({ min: VA_MIN_POST_GAP_MINUTES_MIN, max: VA_MIN_POST_GAP_MINUTES_MAX }),
  antiPileUpDays: Object.freeze({ min: 0, max: VA_ANTI_PILE_UP_DAYS_MAX }),
  otherWriterQuietMinutes: Object.freeze({ min: 0, max: VA_OTHER_WRITER_QUIET_MINUTES_MAX }),
  maxWritesPerRun: Object.freeze({ min: JOB_MIN_WRITES_PER_RUN, max: JOB_MAX_WRITES_PER_RUN }),
});

/* ── Shape bounds (this file's own home — see the header's split rule) ────────── */

/** The persona name is RENDERED INTO OUTWARD TEXT ("— Nadia"), so it is short and plain. */
export const VA_PERSONA_NAME_MAX = 40;
/**
 * The persona charset (F-424). Letters (incl. accents), digits, space, apostrophe,
 * hyphen and dot — nothing else. Three reasons, all of them code-level guarantees:
 * the name goes into a prompt (so `<`, `>` and the fence characters must be impossible),
 * into outward text (so newlines and markdown must be impossible), and one day into a
 * key part (so the KVS grammar in kvs-keys.js must already be satisfied).
 */
const PERSONA_ALLOWED = /[^\p{L}\p{M}\p{Nd} .'-]/gu;
/** Free-text bounds. A VA carries no code, so these are the only long strings it has. */
export const VA_JQL_MAX = 2000;
export const VA_MENTIONS_MAX = 10;
export const VA_SERVICE_DESKS_MAX = 10;
export const VA_QUEUES_PER_DESK_MAX = 20;
export const VA_PROJECTS_MAX = 50;
export const VA_PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]{1,9}$/;
/** Confluence space keys are wider than Jira project keys (personal spaces start `~`). */
export const VA_SPACE_KEY_RE = /^[A-Z0-9_~][A-Z0-9_~.-]{0,60}$/;
export const VA_CONFLUENCE_SPACES_MAX = 20;
/** An accountId shape wide enough for Atlassian's `:`-separated ids, and nothing wilder. */
const ACCOUNT_ID_RE = /^[a-zA-Z0-9:_.\-|]{1,128}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The registers, the languages and the powers are CLOSED sets — an unknown value is dropped. */
export const VA_REGISTERS = Object.freeze(["terse", "plain", "warm"]);
export const VA_LANGUAGES = Object.freeze(["auto", "en", "de"]);
export const VA_MAX_SENTENCES_MIN = 1;
export const VA_MAX_SENTENCES_MAX = 6;
export const VA_MAX_SENTENCES_DEFAULT = 3;

/**
 * The power allow-list. A power the model does not have is a power with NO TOOL, which
 * is the guarantee; the list is here so the save path, the tool picker and the wizard
 * agree on the spelling. `skillIds` is handled separately (it is a list, not a flag).
 *
 * There is deliberately NO power for configuration writes — schemes, workflows,
 * permissions, roles, fields. That is not an off switch: there is no action at all, and
 * `propose_change` is the only path. A flag here would imply a route exists.
 */
export const VA_POWERS = Object.freeze([
  "replyPublic", "replyInternal", "assign", "transition", "editFields",
  "confluenceRead", "confluenceWrite", "git", "webSearch",
]);

/** The item states a ledger row may hold (commit 2 owns the rows; the vocabulary is here). */
export const VA_ITEM_STATES = Object.freeze([
  "seen", "queued", "staged", "posted", "waiting_on_human", "owed", "done", "parked",
]);

/** The default record: the least-privileged agent that is still a valid one. */
export const VA_DEFAULTS = Object.freeze({
  persona: Object.freeze({
    name: "",
    voice: Object.freeze({ register: "plain", greeting: false, maxSentences: VA_MAX_SENTENCES_DEFAULT, language: "auto" }),
    signature: false,
  }),
  // Read may be site-wide; WRITE never is (see normalizeVa).
  scope: Object.freeze({ read: Object.freeze({ site: false, projects: Object.freeze([]) }), write: Object.freeze({ projects: Object.freeze([]) }) }),
  intake: Object.freeze({ serviceDesks: Object.freeze([]), jql: "", mentionsOf: Object.freeze([]), owedFirst: true }),
  cadence: Object.freeze({ preset: "every30", cron: "*/30 * * * *", timeZone: "UTC", postWindow: Object.freeze({ days: Object.freeze([0, 1, 2, 3, 4, 5, 6]), from: "00:00", to: "23:59" }) }),
  powers: Object.freeze({
    replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false,
    confluenceRead: false, confluenceWrite: false, git: false, webSearch: false,
    skillIds: Object.freeze([]),
    confluenceSpaces: Object.freeze([]),
  }),
  guardrails: Object.freeze({
    capsPerHour: VA_CAPS_PER_HOUR_DEFAULT,
    capsPerDay: VA_CAPS_PER_DAY_DEFAULT,
    owedPerHour: VA_OWED_PER_HOUR_DEFAULT,
    shadowTicks: VA_SHADOW_TICKS_DEFAULT,
    minPostGapMinutes: VA_MIN_POST_GAP_MINUTES_DEFAULT,
    antiPileUpDays: VA_ANTI_PILE_UP_DAYS_DEFAULT,
    otherWriterQuietMinutes: VA_OTHER_WRITER_QUIET_MINUTES_DEFAULT,
    approvalProjectKey: "",
    maxItemsPerTick: VA_MAX_ITEMS_PER_TICK_DEFAULT,
    maxWritesPerRun: JOB_DEFAULT_MAX_WRITES_PER_RUN,
  }),
  status: Object.freeze({ paused: false, shadowUntilTick: VA_SHADOW_TICKS_DEFAULT }),
});

/* ── Clamp helpers (pure; the restrictive end is always the fallback) ─────────── */

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : []);
const bool = (v, d) => (typeof v === "boolean" ? v : d);

/**
 * One integer, clamped to [lo,hi]. A blank, non-numeric, boolean or object value falls
 * back to `fallback` — NEVER to `hi`. `report` is called for a value that was present and
 * had to be moved, because a clamp nobody is told about is a silent permission change.
 */
const int = (value, lo, hi, fallback, field, report) => {
  if (value == null || typeof value === "boolean" || typeof value === "object") return fallback;
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    report(field, `"${String(value).slice(0, 40)}" is not a number, so the default (${fallback}) was used.`);
    return fallback;
  }
  const t = Math.trunc(n);
  const c = Math.min(hi, Math.max(lo, t));
  if (c !== t) report(field, `${t} is outside the allowed range ${lo}-${hi}, so it was set to ${c}.`);
  return c;
};

/** The persona name clamp: charset first, then length, then the empty-after-strip case. */
export const clampPersonaName = (value) => clampChars(String(value == null ? "" : value).replace(PERSONA_ALLOWED, "").replace(/\s+/g, " ").trim(), VA_PERSONA_NAME_MAX);

/* ── normalizeVa ─────────────────────────────────────────────────────────────── */

/**
 * Normalise a Virtual Administrator block.
 *
 * @param {object} raw  the `va` block as saved by the wizard, the classic form or REST.
 * @param {object} ctx
 *   @param {string[]} [ctx.projects]      project KEYS the actor may use, from a live read.
 *                                          Omitted = shape validation only (the caller is
 *                                          then responsible for the check — say so in the
 *                                          resolver, do not rely on this module).
 *   @param {Array}    [ctx.serviceDesks]  `[{ id|serviceDeskId, queueIds:[] }]`, from a live read.
 *   @param {string[]} [ctx.timeZones]     allowed IANA zones; omitted = Intl validation.
 *   @param {string[]} [ctx.skillIndex]    skill ids that exist; omitted = shape only.
 * @returns {{ va: object, refused: Array<{field:string, reason:string}> }}
 * @throws  on a structural refusal (no name, site-wide write, unusable cadence).
 */
export const normalizeVa = (raw, ctx = {}) => {
  const src = isObj(raw) ? raw : {};
  const refused = [];
  const report = (field, reason) => { refused.push({ field, reason }); };

  const projectList = Array.isArray(ctx.projects) ? ctx.projects.map((p) => String(isObj(p) ? p.key : p).toUpperCase()) : null;
  const deskList = Array.isArray(ctx.serviceDesks) ? ctx.serviceDesks : null;
  const zoneList = Array.isArray(ctx.timeZones) && ctx.timeZones.length ? ctx.timeZones.map(String) : null;
  const skillIndex = Array.isArray(ctx.skillIndex) ? ctx.skillIndex.map((s) => String(isObj(s) ? s.id : s)) : null;

  /* — persona — */
  const p = isObj(src.persona) ? src.persona : {};
  const rawName = String(p.name == null ? "" : p.name);
  const name = clampPersonaName(rawName);
  if (!name) throw new Error("va.persona.name is required (letters, digits, spaces, ' - . only)");
  if (name !== rawName.trim()) report("persona.name", `The persona name was reduced to "${name}" — it may only contain letters, digits, spaces, apostrophes, hyphens and dots, up to ${VA_PERSONA_NAME_MAX} characters.`);
  const v = isObj(p.voice) ? p.voice : {};
  const register = VA_REGISTERS.includes(v.register) ? v.register : VA_DEFAULTS.persona.voice.register;
  if (v.register != null && register !== v.register) report("persona.voice.register", `"${String(v.register).slice(0, 30)}" is not one of ${VA_REGISTERS.join(", ")}, so "${register}" was used.`);
  const language = VA_LANGUAGES.includes(v.language) ? v.language : VA_DEFAULTS.persona.voice.language;
  if (v.language != null && language !== v.language) report("persona.voice.language", `"${String(v.language).slice(0, 30)}" is not one of ${VA_LANGUAGES.join(", ")}, so "${language}" was used.`);
  const persona = {
    name,
    voice: {
      register,
      greeting: bool(v.greeting, VA_DEFAULTS.persona.voice.greeting),
      maxSentences: int(v.maxSentences, VA_MAX_SENTENCES_MIN, VA_MAX_SENTENCES_MAX, VA_MAX_SENTENCES_DEFAULT, "persona.voice.maxSentences", report),
      language,
    },
    signature: bool(p.signature, false),
  };

  /* — scope. READ may be site-wide; WRITE may not, ever (F-410). — */
  const rawScope = isObj(src.scope) ? src.scope : {};
  const rawRead = isObj(rawScope.read) ? rawScope.read : {};
  const rawWrite = isObj(rawScope.write) ? rawScope.write : {};
  if (rawWrite.site === true) {
    // A THROW, not a silent drop: an operator who ticked "the whole site" and got a
    // quietly-narrowed agent would believe the agent may write everywhere. Gate 7
    // enforces the same rule at the post; this is the same refusal at save time.
    throw new Error('va.scope.write.site is refused: a Virtual Administrator writes only inside a named list of projects. List the projects it may write in.');
  }
  const keys = (list, field) => {
    const out = [];
    for (const k of asArray(list).slice(0, VA_PROJECTS_MAX)) {
      const key = String(isObj(k) ? k.key : k).trim().toUpperCase();
      if (!VA_PROJECT_KEY_RE.test(key)) { report(field, `"${String(k).slice(0, 30)}" is not a project key, so it was dropped.`); continue; }
      if (projectList && !projectList.includes(key)) { report(field, `Project ${key} is not available to this app or to you, so it was dropped.`); continue; }
      if (!out.includes(key)) out.push(key);
    }
    return out;
  };
  const readSite = rawRead.site === true;
  const scope = {
    read: { site: readSite, projects: readSite ? [] : keys(rawRead.projects, "scope.read.projects") },
    write: { projects: keys(rawWrite.projects, "scope.write.projects") },
  };
  // Intake can never widen the write scope, and the write scope can never exceed the
  // read scope: an agent that may write where it cannot read would act on what it
  // cannot check. Narrow the write side, never widen the read side.
  if (!scope.read.site) {
    const outside = scope.write.projects.filter((k) => !scope.read.projects.includes(k));
    for (const k of outside) report("scope.write.projects", `Project ${k} is not in the read scope, so it was dropped from the write scope. An agent cannot write where it cannot read.`);
    scope.write.projects = scope.write.projects.filter((k) => !outside.includes(k));
  }

  /* — intake — */
  const i = isObj(src.intake) ? src.intake : {};
  const serviceDesks = [];
  for (const d of asArray(i.serviceDesks).slice(0, VA_SERVICE_DESKS_MAX)) {
    if (!isObj(d)) continue;
    const id = String(d.serviceDeskId == null ? "" : d.serviceDeskId).trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) { report("intake.serviceDesks", `Service desk id "${String(d.serviceDeskId).slice(0, 20)}" is not usable, so it was dropped.`); continue; }
    const known = deskList ? deskList.find((x) => String(isObj(x) ? (x.id != null ? x.id : x.serviceDeskId) : x) === id) : null;
    if (deskList && !known) { report("intake.serviceDesks", `Service desk ${id} was not found on this site, so it was dropped.`); continue; }
    const knownQueues = known && Array.isArray(known.queueIds) ? known.queueIds.map(String) : null;
    const queueIds = [];
    for (const q of asArray(d.queueIds).slice(0, VA_QUEUES_PER_DESK_MAX)) {
      const qid = String(q).trim();
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(qid)) { report("intake.serviceDesks", `Queue id "${qid.slice(0, 20)}" is not usable, so it was dropped.`); continue; }
      if (knownQueues && !knownQueues.includes(qid)) { report("intake.serviceDesks", `Queue ${qid} is not a queue of service desk ${id}, so it was dropped.`); continue; }
      if (!queueIds.includes(qid)) queueIds.push(qid);
    }
    serviceDesks.push({ serviceDeskId: id, queueIds });
  }
  // JQL IS A STRING HERE AND NOTHING MORE (F-424). It is not parsed, not wrapped and not
  // trusted: the read-scope wrapper is built in commit 4 and the dry `search` bounded to
  // one result runs in the RESOLVER, because only the resolver can talk to Jira.
  const jqlRaw = typeof i.jql === "string" ? i.jql : "";
  if (i.jql != null && typeof i.jql !== "string") report("intake.jql", "The JQL filter must be text, so it was cleared.");
  const jql = clampChars(jqlRaw.trim(), VA_JQL_MAX);
  if (jqlRaw.trim().length > VA_JQL_MAX) report("intake.jql", `The JQL filter was longer than ${VA_JQL_MAX} characters, so it was cut.`);
  const mentionsOf = [];
  for (const a of asArray(i.mentionsOf).slice(0, VA_MENTIONS_MAX)) {
    const id = String(isObj(a) ? a.accountId : a).trim();
    if (!ACCOUNT_ID_RE.test(id)) { report("intake.mentionsOf", `"${id.slice(0, 20)}" is not an account id, so it was dropped.`); continue; }
    if (!mentionsOf.includes(id)) mentionsOf.push(id);
  }
  const intake = { serviceDesks, jql, mentionsOf, owedFirst: bool(i.owedFirst, true) };

  /* — cadence. The presets and the cron maths have ONE home in cron.js. — */
  const c = isObj(src.cadence) ? src.cadence : {};
  const presetIds = SCHEDULE_PRESETS.map((x) => x.id);
  let preset = presetIds.includes(c.preset) ? c.preset : null;
  const rawCron = clampChars(String(c.cron == null ? "" : c.cron), 120).trim().replace(/\s+/g, " ");
  let cron;
  if (preset && preset !== "custom") {
    // Keep the stored cron when it still IS this preset — that is what makes
    // normalizeVa(normalizeVa(x)) stable, because the hour/minute options that produced
    // it are not part of the record.
    const recognised = rawCron && validateCron(rawCron).ok ? cronToPreset(rawCron) : null;
    cron = recognised && recognised.preset === preset ? rawCron : presetToCron(preset, c);
  } else if (rawCron) {
    const check = validateCron(rawCron);
    if (!check.ok) throw new Error(`va.cadence.cron is invalid: ${check.error}`);
    cron = rawCron;
    const recognised = cronToPreset(cron);
    preset = recognised && presetIds.includes(recognised.preset) ? recognised.preset : "custom";
  } else if (preset === "custom") {
    throw new Error("va.cadence.cron is required when the cadence is custom");
  } else {
    if (c.preset != null) report("cadence.preset", `"${String(c.preset).slice(0, 30)}" is not a cadence this app offers, so "${VA_DEFAULTS.cadence.preset}" was used.`);
    preset = VA_DEFAULTS.cadence.preset;
    cron = VA_DEFAULTS.cadence.cron;
  }
  let timeZone;
  const rawZone = String(c.timeZone == null ? "" : c.timeZone).trim();
  if (zoneList) {
    timeZone = zoneList.includes(rawZone) ? rawZone : "UTC";
    if (rawZone && timeZone !== rawZone) report("cadence.timeZone", `"${rawZone.slice(0, 40)}" is not a time zone this site offers, so UTC was used.`);
  } else {
    timeZone = normalizeTimeZone(rawZone);
    if (rawZone && timeZone !== rawZone) report("cadence.timeZone", `"${rawZone.slice(0, 40)}" is not a known time zone, so UTC was used.`);
  }
  const w = isObj(c.postWindow) ? c.postWindow : {};
  const days = [...new Set(asArray(w.days).map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  const hhmm = (value, fallback, field) => {
    const s = String(value == null ? "" : value).trim();
    if (!s) return fallback;
    if (!HHMM_RE.test(s)) { report(field, `"${s.slice(0, 10)}" is not a time of day (HH:MM), so ${fallback} was used.`); return fallback; }
    return s;
  };
  const cadence = {
    preset, cron, timeZone,
    postWindow: {
      // No days listed means NO RESTRICTION, not "never": the caps are the brake, the
      // post window is an opt-in quiet-hours rule. A window that silently meant "never"
      // would be an agent that stages forever and nobody can tell why.
      days: days.length ? days : [...VA_DEFAULTS.cadence.postWindow.days],
      from: hhmm(w.from, VA_DEFAULTS.cadence.postWindow.from, "cadence.postWindow.from"),
      to: hhmm(w.to, VA_DEFAULTS.cadence.postWindow.to, "cadence.postWindow.to"),
    },
  };

  /* — powers: a CLOSED allow-list; an unknown key is refused by name. — */
  const rawPowers = isObj(src.powers) ? src.powers : {};
  const powers = {};
  for (const k of VA_POWERS) powers[k] = bool(rawPowers[k], VA_DEFAULTS.powers[k]);
  for (const k of Object.keys(rawPowers)) {
    if (k === "skillIds" || k === "confluenceSpaces" || VA_POWERS.includes(k)) continue;
    report(`powers.${k}`, `"${k}" is not a power a Virtual Administrator has, so it was dropped. Configuration changes in particular have no action at all — the agent can only propose them.`);
  }
  const skillIds = [];
  for (const s of asArray(rawPowers.skillIds)) {
    const id = String(isObj(s) ? s.id : s).trim();
    if (!id || !/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) { report("powers.skillIds", `"${id.slice(0, 30)}" is not a skill id, so it was dropped.`); continue; }
    if (skillIndex && !skillIndex.includes(id)) { report("powers.skillIds", `Skill ${id} no longer exists, so it was dropped.`); continue; }
    if (skillIds.includes(id)) continue;
    if (skillIds.length >= MAX_RULE_SKILL_IDS) { report("powers.skillIds", `An agent may bind at most ${MAX_RULE_SKILL_IDS} skills, so ${id} was dropped. A rule picks a voice, not a library.`); continue; }
    skillIds.push(id);
  }
  powers.skillIds = skillIds;

  /* — powers.confluenceSpaces: THE WRITE ALLOW-LIST FOR CONFLUENCE (1.5 commit 4c) — */
  //
  // WHY A SPACE LIST AND NOT THE PROJECT SCOPE. `scope.write.projects` answers "which
  // Jira projects may this agent change"; a Confluence page is in a SPACE and has no
  // project, so asking the Jira question of it would make every Confluence write
  // unresolvable and therefore permanently refused. The two allow-lists are different
  // questions about different products and each is enforced where it can be answered:
  // `assertWriteScope` for Jira, this list for Confluence (src/confluence-actions.js).
  //
  // AN EMPTY LIST MEANS NO CONFLUENCE WRITES, never all of them — the same restrictive
  // reading of an absent value as `vaWriteScope`'s empty project list. Turning
  // `confluenceWrite` on without naming a space gives the agent the tools and a refusal
  // it can read, rather than the run of the wiki.
  //
  // READS ARE NOT SCOPED BY IT. A read changes nothing and is already bounded by what
  // the app itself can see in Confluence.
  const confluenceSpaces = [];
  for (const sp of asArray(rawPowers.confluenceSpaces)) {
    const key = String(isObj(sp) ? sp.key : sp).trim().toUpperCase();
    if (!key || !VA_SPACE_KEY_RE.test(key)) { report("powers.confluenceSpaces", `"${String(isObj(sp) ? sp.key : sp).slice(0, 30)}" is not a Confluence space key, so it was dropped.`); continue; }
    if (confluenceSpaces.includes(key)) continue;
    if (confluenceSpaces.length >= VA_CONFLUENCE_SPACES_MAX) { report("powers.confluenceSpaces", `An agent may write in at most ${VA_CONFLUENCE_SPACES_MAX} Confluence spaces, so ${key} was dropped.`); continue; }
    confluenceSpaces.push(key);
  }
  powers.confluenceSpaces = confluenceSpaces;
  if (powers.confluenceWrite === true && !confluenceSpaces.length) {
    // NOT a refused save: the wizard sets the power and the spaces in two steps, and a
    // save that failed between them would be unrecoverable. It is a REPORTED clamp with
    // a named consequence, and the executor refuses every write until a space is named.
    report("powers.confluenceSpaces", "Confluence writing is on but no space is named, so this agent can read Confluence and cannot write to it. Name the spaces it may write in.");
  }

  /* — guardrails — */
  const g = isObj(src.guardrails) ? src.guardrails : {};
  // THE TWO DROPPED FIELDS, refused BY NAME (F-412 / F-425). Silence here would leave an
  // operator believing a setting they can still see in their own JSON is in force.
  if (g.owedUncapped !== undefined) {
    report("guardrails.owedUncapped", `"owedUncapped" no longer exists. Owed replies have their own hourly cap, "owedPerHour" (default ${VA_OWED_PER_HOUR_DEFAULT}); nothing this agent says is uncapped.`);
  }
  if (g.maxBulkTargets !== undefined) {
    report("guardrails.maxBulkTargets", `"maxBulkTargets" no longer exists. One write brake covers every change a run makes: "maxWritesPerRun" (default ${JOB_DEFAULT_MAX_WRITES_PER_RUN}).`);
  }
  const approvalRaw = String(g.approvalProjectKey == null ? "" : g.approvalProjectKey).trim().toUpperCase();
  let approvalProjectKey = "";
  if (approvalRaw) {
    if (!VA_PROJECT_KEY_RE.test(approvalRaw)) report("guardrails.approvalProjectKey", `"${approvalRaw.slice(0, 30)}" is not a project key, so the approval inbox was cleared. Proposals will be filed as internal notes instead.`);
    else if (projectList && !projectList.includes(approvalRaw)) report("guardrails.approvalProjectKey", `Project ${approvalRaw} is not available, so the approval inbox was cleared. Proposals will be filed as internal notes instead.`);
    else approvalProjectKey = approvalRaw;
  }
  const guardrails = {
    capsPerHour: int(g.capsPerHour, 0, VA_CAPS_PER_HOUR_MAX, VA_CAPS_PER_HOUR_DEFAULT, "guardrails.capsPerHour", report),
    capsPerDay: int(g.capsPerDay, 0, VA_CAPS_PER_DAY_MAX, VA_CAPS_PER_DAY_DEFAULT, "guardrails.capsPerDay", report),
    owedPerHour: int(g.owedPerHour, 0, VA_OWED_PER_HOUR_MAX, VA_OWED_PER_HOUR_DEFAULT, "guardrails.owedPerHour", report),
    shadowTicks: int(g.shadowTicks, 0, VA_SHADOW_TICKS_MAX, VA_SHADOW_TICKS_DEFAULT, "guardrails.shadowTicks", report),
    minPostGapMinutes: int(g.minPostGapMinutes, VA_MIN_POST_GAP_MINUTES_MIN, VA_MIN_POST_GAP_MINUTES_MAX, VA_MIN_POST_GAP_MINUTES_DEFAULT, "guardrails.minPostGapMinutes", report),
    antiPileUpDays: int(g.antiPileUpDays, 0, VA_ANTI_PILE_UP_DAYS_MAX, VA_ANTI_PILE_UP_DAYS_DEFAULT, "guardrails.antiPileUpDays", report),
    otherWriterQuietMinutes: int(g.otherWriterQuietMinutes, 0, VA_OTHER_WRITER_QUIET_MINUTES_MAX, VA_OTHER_WRITER_QUIET_MINUTES_DEFAULT, "guardrails.otherWriterQuietMinutes", report),
    approvalProjectKey,
    maxItemsPerTick: int(g.maxItemsPerTick, 1, VA_MAX_ITEMS_PER_TICK_MAX, VA_MAX_ITEMS_PER_TICK_DEFAULT, "guardrails.maxItemsPerTick", report),
    // 0 is MEANINGFUL (an agent that reads, stages and proposes but changes nothing),
    // so the NaN fallback is what picks the default — a blank field, never a real zero.
    maxWritesPerRun: int(g.maxWritesPerRun, JOB_MIN_WRITES_PER_RUN, JOB_MAX_WRITES_PER_RUN, JOB_DEFAULT_MAX_WRITES_PER_RUN, "guardrails.maxWritesPerRun", report),
  };

  /* — status — */
  const st = isObj(src.status) ? src.status : {};
  const status = {
    paused: bool(st.paused, false),
    // Shadow mode is a TICK INDEX, not a date: ticks are the agent's clock everywhere
    // else (the claim, the receipt, the two-phase floor), and a date could be satisfied
    // by a clock skew. Re-arming it after a config change is the ENGINE's job (commit 3),
    // because only the engine knows the current tick index.
    shadowUntilTick: int(st.shadowUntilTick, 0, Number.MAX_SAFE_INTEGER, guardrails.shadowTicks, "status.shadowUntilTick", report),
  };

  return { va: { persona, scope, intake, cadence, powers, guardrails, status }, refused };
};

/* ── The ONE renderer of the guardrail sentences (F-420 class) ────────────────── */

/**
 * The guardrail sentences, rendered from the RECORD — used by the item turn's prompt AND
 * by the wizard's review card.
 *
 * WHY ONE FUNCTION. The prompt tells the model what it may do and the review card tells
 * the admin what the agent will do. If those are authored twice, they drift, and the
 * drift is invisible: the card says "internal notes only" while the prompt offers a
 * public reply. Rendering both from the same record makes the two texts the same text.
 *
 * They are SENTENCES, not a guarantee. Every one of them is also a code gate (§6 of the
 * FRAME); this text exists so the model does not waste attempts on work that a gate will
 * refuse, not so the gate can be skipped. Plain prose on purpose: no markdown, no
 * em-dashes, nothing the voice lint would reject if it were ever echoed outward.
 *
 * @param {object} va a normalised record (the `va` half of `normalizeVa`'s return).
 * @returns {string[]}
 */
export const renderGuardrailSentences = (va) => {
  const r = isObj(va) ? va : {};
  const g = isObj(r.guardrails) ? r.guardrails : VA_DEFAULTS.guardrails;
  const p = isObj(r.powers) ? r.powers : VA_DEFAULTS.powers;
  const scope = isObj(r.scope) ? r.scope : VA_DEFAULTS.scope;
  const persona = isObj(r.persona) ? r.persona : VA_DEFAULTS.persona;
  const voice = isObj(persona.voice) ? persona.voice : VA_DEFAULTS.persona.voice;
  const list = (a) => asArray(a).join(", ");
  const out = [];

  out.push(`You write as ${persona.name || "this agent"}, in a ${voice.register} register, at most ${voice.maxSentences} sentence${voice.maxSentences === 1 ? "" : "s"} per message.`);
  out.push("You never post directly. Every reply is staged and goes out on a later tick, after the checks below.");

  const wp = asArray(scope.write && scope.write.projects);
  out.push(wp.length
    ? `You may change issues only in ${list(wp)}. A change anywhere else is refused by code, not by judgement.`
    : "You may not change any issue. You can read, stage replies and propose changes, and nothing else.");
  const rp = scope.read && scope.read.site ? "every project you can see" : (asArray(scope.read && scope.read.projects).length ? list(scope.read.projects) : "no project");
  out.push(`You may read ${rp}.`);

  out.push(p.replyPublic
    ? "You may answer a customer in the portal only when the request's reporter is the person you are answering. Everything else is an internal note."
    : "Every reply you write is an internal note. You cannot post to a customer portal.");

  const free = VA_POWERS.filter((k) => k !== "replyPublic" && k !== "replyInternal" && p[k]);
  out.push(free.length ? `You may also use: ${list(free)}.` : "You have no tools beyond reading and writing notes.");
  out.push("You cannot change configuration. Not schemes, workflows, permissions, roles or fields. There is no action for it, so propose it instead and a human decides.");

  out.push(`You may post at most ${g.capsPerHour} time${g.capsPerHour === 1 ? "" : "s"} an hour and ${g.capsPerDay} a day. A reply that a human is waiting for has its own cap of ${g.owedPerHour} an hour.`);
  out.push(`A staged reply waits at least ${g.minPostGapMinutes} minutes, and it waits for a later tick than the one that wrote it.`);
  out.push(`If somebody else wrote on the issue in the last ${g.otherWriterQuietMinutes} minutes, you stay quiet.`);
  out.push(`If you already spoke last on an issue within ${g.antiPileUpDays} day${g.antiPileUpDays === 1 ? "" : "s"}, you do not speak again unless a human is waiting on you.`);
  out.push(`You work at most ${g.maxItemsPerTick} item${g.maxItemsPerTick === 1 ? "" : "s"} per tick, and one run may make at most ${g.maxWritesPerRun} change${g.maxWritesPerRun === 1 ? "" : "s"}.`);
  out.push(`An item you cannot finish is parked after ${VA_ITEM_ATTEMPTS_MAX} attempts.`);
  out.push(g.approvalProjectKey
    ? `Anything that needs a human decision goes to ${g.approvalProjectKey} as a request, not to the issue.`
    : "Anything that needs a human decision goes to the issue as an internal note, because no approval inbox is set.");
  return out;
};

/* ── The write-scope context (F-411) ─────────────────────────────────────────── */

/**
 * The `writeScope` context the dispatcher consumes.
 *
 * ONE SHAPE, because the same object is handed to `normalizeAllowedActions` and to
 * `createAgentActionDispatcher` in commit 4, and the gate that reads it
 * (`assertWriteScope`, which lives in `src/shared/agent-actions.js` beside the action
 * gate — it is asked of the Coder's headless PF and of listener agent runs too, neither
 * of which has anything to do with a VA) must not have to guess
 * whether it was given a list, a record or a job. It is always `{ projects: [...] }`,
 * always upper-case keys, and an EMPTY list means "no writes", never "all writes" — the
 * restrictive reading of an absent value is the whole point of the gate.
 *
 * It deliberately does NOT carry the read scope: intake can never widen what may be
 * written, and a single object holding both is how that would happen by accident.
 */
/**
 * THE CONFLUENCE WRITE ALLOW-LIST, read from the record. The sibling of `vaWriteScope`,
 * and deliberately a SEPARATE function rather than a field on the same object: one
 * object holding both would eventually be passed to a gate that only understands one of
 * them, and the half it did not understand would read as "unscoped".
 *
 * `confluenceWrite` off ⇒ the empty list, whatever the record names. The power is the
 * first gate and the spaces are the second; a list left behind by a power that was later
 * switched off must not still authorise anything.
 */
export const vaConfluenceSpaces = (va) => {
  const r = isObj(va) ? va : {};
  const p = isObj(r.powers) ? r.powers : {};
  if (p.confluenceWrite !== true) return [];
  const keys = asArray(p.confluenceSpaces)
    .map((k) => String(isObj(k) ? k.key : k).trim().toUpperCase())
    .filter((k) => VA_SPACE_KEY_RE.test(k));
  return [...new Set(keys)];
};

export const vaWriteScope = (va) => {
  const r = isObj(va) ? va : {};
  const scope = isObj(r.scope) ? r.scope : {};
  const write = isObj(scope.write) ? scope.write : {};
  const projects = asArray(write.projects)
    .map((k) => String(isObj(k) ? k.key : k).trim().toUpperCase())
    .filter((k) => VA_PROJECT_KEY_RE.test(k));
  return { projects: [...new Set(projects)] };
};
