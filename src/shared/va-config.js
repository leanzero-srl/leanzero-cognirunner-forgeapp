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
  VA_SHADOW_TICKS_DEFAULT, VA_SHADOW_TICKS_MAX, VA_SHADOW_UNTIL_TICK_MAX,
  VA_MIN_POST_GAP_MINUTES_DEFAULT, VA_MIN_POST_GAP_MINUTES_MIN, VA_MIN_POST_GAP_MINUTES_MAX,
  VA_ANTI_PILE_UP_DAYS_DEFAULT, VA_ANTI_PILE_UP_DAYS_MAX,
  VA_OTHER_WRITER_QUIET_MINUTES_DEFAULT, VA_OTHER_WRITER_QUIET_MINUTES_MAX,
  VA_ITEM_ATTEMPTS_MAX, VA_ITEM_ROW_CAP, VA_ITEM_TTL_DAYS, VA_TICK_TTL_DAYS, VA_EFFECT_TTL_DAYS,
  VA_WIZARD_TTL_DAYS,
  VA_HISTORY_MAX, VA_NOTES_MAX_CHARS, VA_STAGED_BODY_MAX_CHARS,
  VA_HELD_WRITES_MAX, VA_HELD_WRITE_ARGS_MAX_CHARS,
  VA_CONSTRAINTS_MAX, VA_CONSTRAINT_MAX_BYTES,
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
  shadowUntilTickMax: VA_SHADOW_UNTIL_TICK_MAX,
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
  /* what a SHADOW turn holds instead of writing (F-910) */
  heldWritesMax: VA_HELD_WRITES_MAX,
  heldWriteArgsMaxChars: VA_HELD_WRITE_ARGS_MAX_CHARS,
  /* agent memory (F-423) */
  memoryCompactBytes: VA_MEMORY_COMPACT_BYTES,
  memoryCapBytes: VA_MEMORY_MAX_BYTES,
  constraintsMax: VA_CONSTRAINTS_MAX,
  /* BYTES, not characters (F-498) — the same unit `memoryCapBytes` is measured in. */
  constraintMaxBytes: VA_CONSTRAINT_MAX_BYTES,
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
  // How far ahead the STORED watch may point, as opposed to how much one save adds
  // (F-508). The two are different questions and had one answer, which was "no limit".
  shadowUntilTick: Object.freeze({ min: 0, max: VA_SHADOW_UNTIL_TICK_MAX }),
  // The post gap has a FLOOR as well as a ceiling: the wall-clock half of the speech
  // floor is the gate, so it cannot be set to zero and disabled.
  minPostGapMinutes: Object.freeze({ min: VA_MIN_POST_GAP_MINUTES_MIN, max: VA_MIN_POST_GAP_MINUTES_MAX }),
  antiPileUpDays: Object.freeze({ min: 0, max: VA_ANTI_PILE_UP_DAYS_MAX }),
  otherWriterQuietMinutes: Object.freeze({ min: 0, max: VA_OTHER_WRITER_QUIET_MINUTES_MAX }),
  maxWritesPerRun: Object.freeze({ min: JOB_MIN_WRITES_PER_RUN, max: JOB_MAX_WRITES_PER_RUN }),
});

/**
 * THE SHADOW CEILING — ONE HOME, BOTH DOORS (F-514).
 *
 * `VA_SHADOW_UNTIL_TICK_MAX` used to be applied ONLY at the save door, and
 * `registry-limits.js` claimed in prose that it therefore "REPAIRs the F-484 leftovers".
 * It did not: `normalizeVa` runs on the SAVE/wizard paths only, so a record nobody
 * re-saves is never repaired, and `shadowStateOf` (src/virtual-admin.js) read the stored
 * number raw. A pre-F-484 agent carrying a wall-clock-derived `shadowUntilTick: 8643`
 * stayed in shadow for as long as it took to tick 8643 times — on an hourly cadence,
 * about a year of staging drafts nobody was allowed to post — while the constant that
 * claimed to have fixed it was never consulted on that path. This helper is that
 * constant's only consumer, so the two doors cannot answer differently again.
 *
 * WHY IT IS NOT `min(value, watched + MAX)`, WHICH IS THE OBVIOUS FORMULA.
 *
 * Because that formula is a NO-OP for the thing it is meant to fix. It binds only when
 * `value > watched + MAX`, and in exactly that case the clamped result is STILL greater
 * than `watched` — so the agent is still in shadow, and the ceiling has moved up by the
 * same step the count just took. The in/out verdict comes out bit-identical to no clamp
 * at all; only the number on the badge changes, while the legacy agent goes on staging
 * for a year. Any ceiling expressed as `watched + k` runs away in front of the count the
 * same way. The releasing ceiling has to be ABSOLUTE.
 *
 * SO `watched` DECIDES WHICH OF TWO CASES THIS IS, IT DOES NOT SET THE CEILING:
 *   · REACHABLE — `value <= max(MAX, watched + VA_SHADOW_TICKS_MAX)` — is a watch the
 *     engine could legitimately have armed, and it is KEPT UNTOUCHED. `rearmShadow`
 *     (src/va-admin.js) runs AFTER `normalizeVa` and is raise-only by design, so an agent
 *     with 600 receipts is armed to `600 + shadowTicks`: a stored value above the
 *     absolute ceiling that is CORRECT. A flat clamp would have silently switched shadow
 *     mode off for every agent past its 500th tick — a worse defect than this one.
 *     `shadowTicks`' own MAXIMUM is used rather than the agent's configured value, so the
 *     ceiling cannot be moved under an already-armed watch by lowering the guardrail.
 *   · UNREACHABLE — anything above that — is not a watch, it is an F-484 leftover in the
 *     wrong unit, and it is replaced by the flat absolute ceiling. 8643 with 3 ticks
 *     watched becomes 500 and really does end at the 500th tick. If the agent is already
 *     past 500 the watch is simply over, which is the right answer for a number that was
 *     never a tick index in the first place.
 *
 * A lost `va_health` row (its counter can expire) re-reads as 0 watched ticks, which can
 * make a reachable value look unreachable and re-impose up to 500 ticks of shadow. That
 * is the restrictive direction — staging instead of speaking — which is the one every
 * other reader of this counter takes when it cannot tell.
 *
 * `watched` omitted gives the plain absolute ceiling. That used to be described here as
 * "the save door, which cannot know the tick index" — and F-519 is what that sentence
 * cost. The door CAN know it: it reads `va_health` three steps later for the re-arm
 * anyway. Not asking meant the door cut every watch the engine had armed above 500, and
 * reported a refusal for a number the admin never sent. The door now passes its own
 * `watched` (`normalizeVa`'s `doorWatch`), so an omitted `watched` here means only what
 * it says — "no count available" — and both doors answer with one ceiling
 * (`shadowReachableCeiling`).
 */
/**
 * THE REACHABILITY CEILING ITSELF — the one arithmetic, named (F-519).
 *
 * `clampShadowUntilTick` is the READ side's clamp; `normalizeVa`'s `int` is the SAVE
 * door's, because the door must also REPORT what it moved. Two clamps, and before F-519
 * they used two different ceilings: the door a flat `VA_CEILINGS.shadowUntilTick.max`,
 * the reader `max(MAX, watched + VA_SHADOW_TICKS_MAX)`. So an agent with 600 prepare
 * receipts, legitimately armed by `rearmShadow` to 603, was cut to 500 by the very next
 * save — with a `refused[]` line naming a number the admin never sent — and if the
 * health row could not be read the re-arm did not restore it. The agent went LIVE 103
 * ticks early: the permissive direction, against a docblock promising the opposite.
 *
 * So the CEILING has one home and both clamps ask it. `watched <= 0` or not a number is
 * the plain absolute ceiling, which is the restrictive answer and the one every other
 * reader of this counter takes when it cannot tell.
 */
export const shadowReachableCeiling = (watched) => {
  const w = Number(watched);
  return Number.isFinite(w) && w > 0
    ? Math.max(VA_SHADOW_UNTIL_TICK_MAX, Math.trunc(w) + VA_SHADOW_TICKS_MAX)
    : VA_SHADOW_UNTIL_TICK_MAX;
};

export const clampShadowUntilTick = (value, watched = null) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n) <= shadowReachableCeiling(watched) ? Math.trunc(n) : VA_SHADOW_UNTIL_TICK_MAX;
};

/* ══════════════════════════════════════════════════════════════════════════════
 * F-523 — HOW THE WATCH COUNT REACHES THE *SECOND* NORMALISATION
 *
 * A VA save runs `normalizeVa` TWICE: once at the door that can reach Jira
 * (`prepareVaSave`, src/va-admin.js — live catalogue, dry search, shadow re-arm) and
 * once inside `normalizeJob` (src/scheduled-jobs.js), which is a storage module and
 * reaches nothing. F-519 gave the first door the real watch count and left the second
 * one deriving a watch from the STORED value — so the second pass's ceiling was the
 * ceiling of what was stored, never of what `rearmShadow` had just armed. Stored 100,
 * watched 600, `shadowTicks` 50: door 1 keeps 100, the re-arm raises it to 650, door 2
 * derives `100 - 50 = 50`, ceils at 500 and CUTS the armed watch to 500 — under the 600
 * already watched, so the edited agent was live with no shadow period at all, and
 * `normalizeJob` dropped the refusal that said so.
 *
 * The fix is that the second pass is asked with the SAME watch count as the first, and
 * the only way to carry it there is on the prepared input: `prepareVaSave` returns the
 * input its callers hand to `saveJob` verbatim, and those callers (the resolver in
 * src/index.js and `?resource=agents` in src/rules-api.js) must not each have to
 * remember a second argument — a rule remembered at two call sites is a rule that will
 * be forgotten at one of them.
 *
 * WHY IT CANNOT BE FORGED. `prepareVaSave` ALWAYS sets this key on the input it
 * returns (to the count, or to `null` when the counter could not be read), so a value
 * sent by a REST client is overwritten before it can be read, and every door that
 * accepts a `mode:"va"` body goes through `prepareVaSave` — the Rules API's generic
 * collections door refuses `mode:"va"` outright (F-478). It is also the SAFE direction
 * on its own: this number only ever widens the ceiling for `status.shadowUntilTick`, and
 * a larger shadow ceiling means MORE supervision, never less.
 *
 * It is stripped by `normalizeJob` — the stored record is built key by key, so it never
 * reaches storage, the index row or the REST projection.
 * ════════════════════════════════════════════════════════════════════════════ */
export const VA_SAVE_WATCH_FIELD = "__vaWatchedTicks";

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

/**
 * The posting window a NEW agent starts with, and - since F-953 - the one the RECORD falls
 * back to as well: the working week, working hours.
 *
 * It is declared here, above `VA_DEFAULTS`, because both read it and one home is the point.
 */
export const VA_SUGGESTED_POST_WINDOW = Object.freeze({
  days: Object.freeze([1, 2, 3, 4, 5]), from: "08:00", to: "18:00",
});

/**
 * WHAT "NO RESTRICTION" IS SPELLED AS, once.
 *
 * An EXPLICITLY empty day list means the agent may post on any day (the F-916 meaning, kept),
 * and this is the list that meaning expands to. It used to be `VA_DEFAULTS.cadence.postWindow
 * .days`, which is how the two questions - "what does an admin who said nothing get" and
 * "what does an admin who said 'every day' get" - ended up with one answer, and the wide one.
 */
export const VA_NO_POST_RESTRICTION_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

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
  // F-953 - the window an agent gets when NOBODY SET ONE is the working week, working
  // hours. It used to be Sun-Sat 00:00-23:59, so any path that skipped the cadence step
  // shipped an agent allowed to post at 03:00 on a Sunday and nobody had chosen that.
  cadence: Object.freeze({ preset: "every30", cron: "*/30 * * * *", timeZone: "UTC", postWindow: VA_SUGGESTED_POST_WINDOW }),
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

/* ── WHAT A NEW AGENT IS OFFERED, as opposed to what the RECORD falls back to ─── */

/*
 * F-916 — TWO DIFFERENT QUESTIONS THAT HAD ONE ANSWER, and F-953 — the answer was wrong
 * on both.
 *
 * `VA_DEFAULTS.cadence` answers "what does normalizeVa use when a field is ABSENT", and
 * what an admin who never reached the cadence step gets. That used to be Sun-Sat
 * 00:00-23:59, because "an empty day list means no restriction" was implemented by
 * falling back to the default list - so the two questions shared one answer and it was the
 * WIDE one. Any path that skipped the cadence step shipped a 24/7 agent silently, and the
 * review card then stated it back as if it had been chosen.
 *
 * Since F-953 they are separate: absent means the working week (`VA_SUGGESTED_POST_WINDOW`,
 * declared above `VA_DEFAULTS`), and an EXPLICIT empty day list still means no restriction
 * (`VA_NO_POST_RESTRICTION_DAYS`). The zone stays UTC here, because a save path has no
 * viewer to ask; the viewer's own zone is resolved by `resolveDefaultTimeZone` below, on
 * the side that has one.
 */

/** The viewer's own IANA zone, or "" when the runtime cannot say. Safe on Node and in an iframe. */
export const viewerTimeZone = () => {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof z === "string" ? z : "";
  } catch { return ""; }
};

/**
 * The zone a NEW agent starts in: the viewer's, else the site's if a caller can supply
 * one, else UTC. `allowed` is the site's zone list when there is one - a zone the picker
 * cannot offer is not a default, it is a value the admin cannot see or change.
 *
 * There is no site zone on the wizard catalogue today (the bridge does not expose one),
 * which is why `site` is a parameter rather than a read: the day it exists, one call
 * site changes and both doors follow.
 */
export const resolveDefaultTimeZone = (viewer, site, allowed) => {
  const list = Array.isArray(allowed) && allowed.length ? allowed.map(String) : null;
  for (const candidate of [viewer, site]) {
    const z = String(candidate == null ? "" : candidate).trim();
    if (!z) continue;
    if (list) { if (list.includes(z)) return z; continue; }
    if (normalizeTimeZone(z) === z) return z;
  }
  return list && !list.includes("UTC") ? list[0] : "UTC";
};

/** The cadence block a NEW agent starts with. The preset and cron stay the record's own. */
export const vaSuggestedCadence = (opts = {}) => {
  const o = isObj(opts) ? opts : {};
  return {
    preset: VA_DEFAULTS.cadence.preset,
    cron: VA_DEFAULTS.cadence.cron,
    timeZone: resolveDefaultTimeZone(o.viewer === undefined ? viewerTimeZone() : o.viewer, o.site, o.allowed),
    postWindow: { days: [...VA_SUGGESTED_POST_WINDOW.days], from: VA_SUGGESTED_POST_WINDOW.from, to: VA_SUGGESTED_POST_WINDOW.to },
  };
};

/* ── COPY: the words an admin reads, in one home ──────────────────────────────── */

/**
 * Record paths, in the admin's words. The save path refuses by FIELD PATH because that is
 * what a REST caller needs; a person filling in a form needs the label above the box.
 * One map, read by both doors.
 */
export const VA_FIELD_LABELS = Object.freeze({
  "persona.name": "Name",
  "persona.voice": "Voice",
  "persona.voice.register": "Register",
  "persona.voice.maxSentences": "Sentences per reply",
  "persona.voice.language": "Language",
  intake: "Where it looks for work",
  "intake.serviceDesks": "Service desk queues",
  "intake.jql": "JQL filter",
  "intake.mentionsOf": "Mentions it picks up",
  "scope.read": "Projects it may read",
  "scope.read.projects": "Projects it may read",
  "scope.write": "Projects it may change",
  "scope.write.projects": "Projects it may change",
  cadence: "Cadence",
  "cadence.preset": "Cadence",
  "cadence.timeZone": "Time zone",
  "cadence.postWindow": "Posting window",
  "cadence.postWindow.days": "Posting days",
  "cadence.postWindow.from": "Posting window start",
  "cadence.postWindow.to": "Posting window end",
  powers: "Powers",
  "powers.skillIds": "Skills",
  "powers.confluenceSpaces": "Confluence spaces",
  guardrails: "Brakes",
  "guardrails.approvalProjectKey": "Approval inbox",
});

/** A field path rendered for a person. An unmapped path keeps its own name rather than vanishing. */
export const vaFieldLabel = (path) => VA_FIELD_LABELS[String(path || "")] || String(path || "");

/**
 * The sentences the ADMIN PANEL says about an agent, in one home, because two homes is how
 * the tab strip and the Agents tab came to describe the same product with two different
 * promises ("after eleven checks" in a place where nothing explains what the eleven are).
 */
export const VA_COPY = Object.freeze({
  /** What a virtual administrator IS, for the tab strip and the tab header alike. */
  whatItIs: "A virtual administrator works a queue on a schedule: it reads, it drafts a reply, and it posts only after re-reading the thread and passing every guardrail you set. It starts in shadow mode, where it drafts and posts nothing.",
  /** The name refusal, in words rather than in the record's path and charset. */
  nameRequired: "Give the administrator a name.",
  /** The charset rule, said once the admin has typed something that cannot be used. */
  nameCharset: "A name may use letters, digits, spaces, apostrophes, hyphens and dots.",
  /** The intake step's refusal: it names all three ways to give an agent work. */
  intakeEmpty: "This agent would have nothing to work on. Give it at least one source: tick a service desk queue, write a JQL filter, or name someone whose mentions it should pick up.",
  /** Said beside the fast cadences, because the cadence is not the delivery time. */
  cadenceStagingNote: "How often it looks for work. A reply it drafts goes out on a later run, at the earliest 15 minutes after it was drafted.",
});

/**
 * The marker the review card puts beside a value the admin did not choose.
 *
 * F-953 - IT IS A STAR NOW, EXPLAINED ONCE. It used to be the word "(default)" inline, and
 * a card with five of them read as a form full of warnings rather than as a summary; the
 * reader's eye went to the parentheses instead of to the agent. One character beside the
 * value, one footnote under the card (`VA_DEFAULT_FOOTNOTE`), rendered only when something
 * actually carries the mark.
 */
export const VA_DEFAULT_MARK = " *";
/** The one line that says what the star means. Rendered once, or not at all. */
export const VA_DEFAULT_FOOTNOTE = "Items marked * are defaults you did not change.";

/*
 * ONE LABEL PER POWER, and the review card reads the SAME table the powers step renders.
 * It used to live in `VaPickers.jsx` alone, so the picker said "Reply internally" and the
 * review sentence two steps later said "Its powers are replyInternal." - the record's own
 * spelling, in a sentence written for a person.
 *
 * The IDS come from `VA_POWERS`; this table only supplies copy, so a power added there
 * without a row here still renders (by its id) rather than disappearing.
 */
export const VA_POWER_COPY = Object.freeze({
  replyPublic: Object.freeze({ label: "Reply to the customer", short: "reply to the customer", desc: "Answers in the portal, and only when the person being answered is the request's reporter." }),
  replyInternal: Object.freeze({ label: "Reply internally", short: "reply internally", desc: "Writes an internal note on the issue. Customers never see it." }),
  assign: Object.freeze({ label: "Assign", short: "assign issues", desc: "Sets the assignee of an issue inside the write scope." }),
  transition: Object.freeze({ label: "Transition", short: "move issues through the workflow", desc: "Moves an issue through its workflow inside the write scope." }),
  editFields: Object.freeze({ label: "Edit fields", short: "edit issue fields", desc: "Changes ordinary issue fields inside the write scope. Never configuration." }),
  confluenceRead: Object.freeze({ label: "Read Confluence", short: "read Confluence", desc: "Reads pages so an answer can quote your documentation." }),
  confluenceWrite: Object.freeze({ label: "Write Confluence", short: "write Confluence pages", desc: "Creates or updates a page. Updates are version checked." }),
  git: Object.freeze({ label: "Git", short: "read repositories and open pull requests", desc: "Reads repositories and opens pull requests through a configured connection." }),
  webSearch: Object.freeze({ label: "Web search", short: "search the web", desc: "Looks something up on the public web before answering." }),
});

/** A power in a sentence ("it may reply internally"), or its id when the table has no row. */
export const vaPowerPhrase = (id) => (VA_POWER_COPY[id] && VA_POWER_COPY[id].short) || String(id || "");
/** A power as a control's label. */
export const vaPowerLabel = (id) => (VA_POWER_COPY[id] && VA_POWER_COPY[id].label) || String(id || "");

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

/* ── F-927: the CLOSED key vocabulary of a VA record, at the SAVE doors only ── */

/*
 * WHAT WENT WRONG. `normalizeVa` builds its output key by key, so a key it does not
 * know was simply not copied — in SILENCE. Only two names were refused out loud
 * (`guardrails.owedUncapped`, `guardrails.maxBulkTargets`), and only because they had
 * once existed. Everything else vanished: an admin-panel spinner wrote
 * `guardrails.shadowUntilTick` (the field lives under `status`) for a whole release,
 * the save returned ok, the record read back without it, and nobody could tell the
 * difference between "saved and ignored" and "never sent".
 *
 * THE VOCABULARY IS DERIVED, NOT RETYPED. Every list below comes from `VA_DEFAULTS`
 * (and `VA_POWERS`), so a key added to the record's shape is accepted the moment it
 * exists and cannot be forgotten here. The two list-valued powers are named explicitly
 * because they are not booleans in `VA_DEFAULTS`' power block's sense but are still
 * documented keys.
 *
 * TOP-LEVEL KEYS OF EACH SECTION ONLY. `persona.voice`, `scope.read`, `scope.write` and
 * `cadence.postWindow` are validated by their own clamps (an unknown key inside them is
 * ignored by a reader that names the fields it wants). The defect this closes, and every
 * shape a form or a REST client actually produces, is a top-level key on a section.
 *
 * SAVE REFUSES, READ STAYS LENIENT. This runs only when the caller passes
 * `{ strict: true }`, and the ONLY caller that does is `prepareVaSave`
 * (src/va-admin.js) — the single door behind BOTH save paths, the classic form resolver
 * and the Rules REST API's `?resource=agents`. The storage-module pass inside
 * `normalizeJob`, the wizard machine and the admin panel's live preview stay lenient on
 * purpose: they re-normalise records that are already this module's own output, and a
 * stored row carrying a stale key must still LOAD rather than become unopenable.
 *
 * THE REFUSAL IS A THROW, which `prepareVaSave` already turns into the one shape the VA
 * save doors speak — `fail("va_invalid", { message, refused:[{field:"va",reason}] })`,
 * rendered by the admin UI and returned by REST as `400 { error, refused }` through
 * `errBody`. It names the key, so the operator can see the typo they made.
 *
 * THE TWO LEGACY NAMES KEEP THEIR OWN SENTENCES. `owedUncapped` and `maxBulkTargets`
 * are reported (and dropped), not thrown: they explain what REPLACED them, which a
 * generic "not a setting" line cannot, and an old export being re-imported should not
 * be unsavable.
 */
const VA_KNOWN_KEYS = Object.freeze({
  persona: Object.freeze(Object.keys(VA_DEFAULTS.persona)),
  scope: Object.freeze(Object.keys(VA_DEFAULTS.scope)),
  intake: Object.freeze(Object.keys(VA_DEFAULTS.intake)),
  cadence: Object.freeze(Object.keys(VA_DEFAULTS.cadence)),
  powers: Object.freeze([...VA_POWERS, "skillIds", "confluenceSpaces"]),
  guardrails: Object.freeze(Object.keys(VA_DEFAULTS.guardrails)),
});

/** The names refused with their own sentence, so the generic refusal skips them. */
const VA_RETIRED_KEYS = Object.freeze({ guardrails: Object.freeze(["owedUncapped", "maxBulkTargets"]) });

/** Every documented key of a section, for a refusal that says what WOULD have worked. */
export const vaKnownKeys = (section) => [...(VA_KNOWN_KEYS[section] || [])];

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
 *   @param {object}   [ctx.existing]      the STORED `va` block this save replaces.
 *   @param {number}   [ctx.watchedTicks]  the agent's own prepare-receipt count (F-519);
 *                                          omitted/null = "could not be read", which is
 *                                          the restrictive case — see `doorWatch` below.
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
  // F-916 — the message a PERSON reads. It is the first thing the classic form renders
  // (the preview runs on an empty form), so it must be a sentence rather than a record
  // path and a charset. The path is still carried by the `refused` row below when a name
  // was typed and had to be reduced, which is what a REST caller needs.
  if (!name) throw new Error(rawName.trim() ? `${VA_COPY.nameRequired} ${VA_COPY.nameCharset}` : VA_COPY.nameRequired);
  if (name !== rawName.trim()) report("persona.name", `The persona name was reduced to "${name}", it may only contain letters, digits, spaces, apostrophes, hyphens and dots, up to ${VA_PERSONA_NAME_MAX} characters.`);
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
  /*
   * F-953 - ABSENT AND EMPTY ARE DIFFERENT ANSWERS.
   *
   * `windowGiven` is whether the record HAS a posting window at all, and `daysGiven` is
   * whether that window states its days. A record with neither gets the working week
   * (`VA_DEFAULTS.cadence.postWindow`); a record whose window states an EXPLICITLY EMPTY
   * day list keeps the F-916 meaning, no restriction, and gets every day. These used to be
   * the same code path, which is how "nobody chose a window" and "the admin chose every
   * day" both produced Sun-Sat 00:00-23:59.
   */
  const windowGiven = isObj(c.postWindow);
  const w = windowGiven ? c.postWindow : {};
  const daysGiven = Array.isArray(w.days);
  const days = [...new Set(asArray(w.days).map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  /*
   * F-948 - A TYPO IN A BOUND USED TO WIDEN THE WINDOW TO THE WHOLE DAY.
   *
   * `from: "18.00"` (a dot, the shape half of Europe types) failed HHMM_RE and fell back
   * to VA_DEFAULTS' 00:00-23:59, so an operator narrowing an agent to the evening got an
   * agent that posts at 04:00 - the one direction a restriction must never fail in, and
   * the opposite of what every other unreadable input here does (an unreadable time zone
   * blocks two lines above, an unresolvable project is dropped from the write scope).
   *
   * SAVE REFUSES BY NAME. At the save doors (`strict: true`, the F-927 flag, whose only
   * caller is `prepareVaSave` - the single door behind the classic form and REST) a
   * malformed bound is a THROW that names the field and the shape that would have worked,
   * so the typo is corrected by the person who made it rather than reinterpreted.
   *
   * A LENIENT READ KEEPS THE TYPO AND CLOSES THE WINDOW. A stored row must still LOAD -
   * that is the whole reason the read path is lenient - so the malformed bound is KEPT,
   * clamped to a displayable length, and reported. Keeping it, rather than blanking it,
   * is what makes this stable under re-normalisation: `saveJob` normalises a second time,
   * and a bound blanked to null would read as "absent" there and come back as the
   * 00:00-23:59 default - the same widening, one pass later. `inPostWindow` reads a
   * present-but-unreadable bound as CLOSED (`window_unreadable`), so the agent stages and
   * never posts, and the receipt names the reason.
   */
  const hhmm = (value, fallback, field) => {
    const s = String(value == null ? "" : value).trim();
    if (!s) return fallback;
    if (!HHMM_RE.test(s)) {
      const shown = clampChars(s.replace(/[\u0000-\u001f]/g, " "), 10);
      if (ctx.strict === true) throw new Error(`va.${field} is refused: "${shown}" is not a time of day. Use HH:MM on the 24-hour clock, for example 18:00.`);
      report(field, `"${shown}" is not a time of day (HH:MM), so this agent posts nothing until it is corrected.`);
      return shown;
    }
    return s;
  };
  const cadence = {
    preset, cron, timeZone,
    postWindow: {
      // An EXPLICITLY empty day list means NO RESTRICTION, not "never": the caps are the
      // brake, the post window is an opt-in quiet-hours rule. A window that silently meant
      // "never" would be an agent that stages forever and nobody can tell why. A window
      // nobody stated at all is a different answer, and it is the working week (F-953).
      days: days.length ? days : [...(daysGiven ? VA_NO_POST_RESTRICTION_DAYS : VA_DEFAULTS.cadence.postWindow.days)],
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
    report(`powers.${k}`, `"${k}" is not a power a Virtual Administrator has, so it was dropped. Configuration changes in particular have no action at all, the agent can only propose them.`);
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
  // F-519 — see the long note on `shadowUntilTick` below. `ctx.watchedTicks` is the
  // agent's own prepare-receipt count when the caller could read it; when it could not,
  // the stored watch is turned back into the count that makes it reachable, which is what
  // "a save must never LOWER an armed watch it cannot verify" means in arithmetic.
  const ctxWatched = Number(ctx.watchedTicks);
  const storedUntil = Number(isObj(ctx.existing) && isObj(ctx.existing.status) ? ctx.existing.status.shadowUntilTick : NaN);
  const doorWatch = ctx.watchedTicks != null && Number.isFinite(ctxWatched) && ctxWatched >= 0
    ? Math.trunc(ctxWatched)
    : (Number.isFinite(storedUntil) && storedUntil > 0 ? Math.max(0, Math.trunc(storedUntil) - VA_SHADOW_TICKS_MAX) : 0);
  const status = {
    paused: bool(st.paused, false),
    // Shadow mode is a TICK INDEX, not a date: ticks are the agent's clock everywhere
    // else (the claim, the receipt, the two-phase floor), and a date could be satisfied
    // by a clock skew. Re-arming it after a config change is the ENGINE's job (commit 3),
    // because only the engine knows the current tick index.
    /*
     * F-508 — IT HAS A CEILING AT THE DOOR NOW, AND THE CLAMP IS REPORTED.
     *
     * This was the one VA number accepted up to `MAX_SAFE_INTEGER` with no bound and no
     * `report`, on the reasoning that only the engine knows the current tick. True, and
     * beside the point: "how far ahead may a watch point AT ALL" is knowable here, and
     * leaving it unbounded meant the save path's re-arm quietly REPLACED anything it
     * thought unreachable — turning `shadowUntilTick: 500` into 6 with a 200 and an
     * empty `refused[]`. An unreachable value is a REFUSAL AT THE DOOR, said out loud,
     * not a silent substitution three steps later.
     */
    /*
     * F-519 — THE DOOR'S CEILING *IS* THE READ SIDE'S REACHABILITY RULE.
     *
     * F-514 routed this through `clampShadowUntilTick` but left `int`'s ceiling at the
     * flat absolute max, and `int` runs FIRST — so the door cut every value the ENGINE
     * had legitimately armed above 500 (`rearmShadow` is raise-only and runs after this,
     * so an agent with 600 prepare receipts is armed to 603) and REPORTED a refusal for a
     * number the admin never sent. The only thing that put it back was the re-arm, which
     * reads `va_health` — a row with a TTL. When that row had expired or faulted the
     * watch count read 0, the restore floor became `0 + shadowTicks`, and the clamped 500
     * stood: the agent went LIVE 103 ticks early. A shortening, in the PERMISSIVE
     * direction, on the one counter whose whole contract is to err the other way.
     *
     * `doorWatch` is how many of its own ticks this agent has been watched:
     *   · `ctx.watchedTicks` — a number — is the real count, read from `va_health` by the
     *     save path (`watchedTicksForSave`, src/virtual-admin.js).
     *   · ABSENT or unreadable is the RESTRICTIVE case: the door must not LOWER what is
     *     already stored. The watch that makes the stored value exactly reachable is used
     *     instead, so a stored 603 survives untouched and a 604 sent by an admin is still
     *     refused. `null` therefore never widens anything: with no stored value (a new
     *     agent, the wizard, the shape-only doors) it is the plain absolute ceiling.
     *
     * That same restrictive case is what keeps the SECOND normalisation honest: `saveJob`
     * re-normalises without a catalogue and without a watch count, and a flat ceiling
     * there would have re-cut the value this door just preserved.
     *
     * `int` still does the REPORTING — a value above the ceiling must be refused out
     * loud — and `clampShadowUntilTick` is asked with the same `doorWatch`, so the number
     * stored and the number the admin was told about cannot differ.
     */
    shadowUntilTick: clampShadowUntilTick(int(st.shadowUntilTick, 0, shadowReachableCeiling(doorWatch), guardrails.shadowTicks, "status.shadowUntilTick", report), doorWatch),
  };

  /* — F-927: unknown keys, refused BY NAME at the save doors (see the note above the
   * `VA_KNOWN_KEYS` table). Last, so a structurally broken record still fails on the
   * thing an operator can act on first (a missing name, a site-wide write scope, an
   * unusable cadence) rather than on a typo further down the same body. — */
  if (ctx.strict === true) {
    const unknown = [];
    for (const section of Object.keys(VA_KNOWN_KEYS)) {
      const raw = isObj(src[section]) ? src[section] : null;
      if (!raw) continue;
      const retired = VA_RETIRED_KEYS[section] || [];
      for (const k of Object.keys(raw)) {
        if (VA_KNOWN_KEYS[section].includes(k) || retired.includes(k)) continue;
        unknown.push(`${section}.${k}`);
      }
    }
    if (unknown.length) {
      // ONE sentence, every offending key named with its section, plus the vocabulary
      // that WOULD have been accepted — a refusal an operator can act on without opening
      // the docs. Grouped by section so a body with two typos reads as two facts.
      const bySection = {};
      for (const path of unknown) {
        const section = path.slice(0, path.indexOf("."));
        (bySection[section] = bySection[section] || []).push(path.slice(section.length + 1));
      }
      const parts = Object.keys(bySection).map((section) =>
        `${bySection[section].map((k) => `"${k}"`).join(", ")} under ${section} (the settings it has there are: ${VA_KNOWN_KEYS[section].join(", ")})`);
      throw new Error(`va.${unknown.join(", va.")} ${unknown.length > 1 ? "are" : "is"} refused: a Virtual Administrator has no ${parts.join("; and no ")}. Remove the key or correct its name.`);
    }
  }

  return { va: { persona, scope, intake, cadence, powers, guardrails, status }, refused };
};

/* ── mergeVaPatch — what a PARTIAL `va` in a PUT means (F-477 / F-492) ───────── */

/**
 * Deep-merge a PARTIAL `va` block onto the stored one, so a PUT is a patch here too.
 *
 * WHY THIS EXISTS. The REST PUT merge is a shallow, fixed key list, and `va` was not on
 * it, so `{"va":{"persona":{"name":"Ada"}}}` REPLACED the whole block. `normalizeVa`
 * then rebuilt every absent sub-object from `VA_DEFAULTS` — which RESUMED a paused
 * agent, reset `status.shadowUntilTick` and re-widened every guardrail an admin had
 * tightened. A rename is not a permission change, and nothing in the request said it
 * was one.
 *
 * A shallow merge of `va` alone would not have been enough either: `{"persona":{"name"}}`
 * would still have dropped `persona.voice`. So the merge is RECURSIVE over plain
 * objects, one home, used by every door that patches a record.
 *
 * ARRAYS REPLACE, never concatenate. `scope.write.projects` and `powers.skillIds` are
 * allow-lists, and an allow-list that grows by being sent again is a permission change
 * nobody asked for; sending `[]` must be able to mean "none".
 *
 * `null` AND `undefined` MEAN "KEEP EXISTING" — for sub-objects and for scalars alike
 * (F-492). The recursion above only protected keys that were ABSENT from the patch: a
 * key present with a null value was copied through as null, `normalizeVa` read null as
 * absent, and rebuilt it from `VA_DEFAULTS`. That is the SAME un-pause, the same shadow
 * reset and the same re-widened caps F-477 was written to stop, reached through a
 * different door — `{"status":null}` resumed a paused agent, and
 * `{"guardrails":{"capsPerHour":null}}` restored the default cap. Serialisers that emit
 * every key of a form, null included, make that the ordinary shape of a PUT, not an
 * exotic one. "Clear this back to the default" is therefore NOT expressible as null; it
 * is expressed by sending the default value, which is a deliberate statement a caller
 * has to make. The one exception stays the array case above: `[]` is a real, sent value
 * and still means "none", while a null array keeps the existing list.
 *
 * It merges SHAPE only. Every clamp, every refusal and every allow-list check is still
 * `normalizeVa`'s, run on the merged result.
 */
export const mergeVaPatch = (existing, patch) => {
  if (!isObj(patch)) return isObj(existing) ? existing : patch;
  if (!isObj(existing)) return patch;
  const out = { ...existing };
  for (const k of Object.keys(patch)) {
    const a = existing[k];
    const b = patch[k];
    if (b === null || b === undefined) continue; // "keep existing" — see F-492 above.
    out[k] = isObj(a) && isObj(b) ? mergeVaPatch(a, b) : b;
  }
  return out;
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
