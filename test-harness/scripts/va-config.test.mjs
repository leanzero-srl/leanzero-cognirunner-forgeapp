/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/va-config.js — the Virtual Administrator record
// (release 1.5, commit 1). Auto-discovered by run-offline.mjs.
//
// What it proves, in the order a regression would hurt:
//   1. THE REFUSALS. A site-wide write scope throws at save time; `owedUncapped` and
//      `maxBulkTargets` are dropped with a named entry in `refused[]`, never in silence.
//   2. EVERY CLAMP, AT BOTH ENDS, and always toward the restrictive side: an unparseable
//      cap becomes the DEFAULT, never the maximum.
//   3. THE LIVE-DATA VALIDATION. Project keys, service desks, queues, time zones and
//      skill ids are checked against the lists the resolver supplies.
//   4. ROUND-TRIP STABILITY. normalizeVa(normalizeVa(x)) === normalizeVa(x), and the
//      second pass refuses nothing new. A normaliser that is not idempotent rewrites a
//      record on every save, which is how a stored cap silently drifts.
//   5. The two renderers: renderGuardrailSentences (the ONE source of the prompt AND the
//      wizard review card) and vaWriteScope (the dispatcher's context).
// Run: node scripts/va-config.test.mjs
import assert from "node:assert/strict";
import {
  normalizeVa, renderGuardrailSentences, vaWriteScope, clampPersonaName,
  VA_DEFAULTS, VA_LIMITS, VA_CEILINGS, VA_POWERS, VA_REGISTERS, VA_LANGUAGES, VA_PERSONA_NAME_MAX,
  VA_JQL_MAX, VA_PROJECT_KEY_RE, VA_ITEM_STATES, vaConfluenceSpaces, VA_CONFLUENCE_SPACES_MAX,
  mergeVaPatch,
} from "../../src/shared/va-config.js";
import * as limits from "../../src/shared/registry-limits.js";
import { validateCron, cronToPreset } from "../../src/shared/cron.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const throws = (fn, re, m) => {
  try { fn(); fail++; console.log("FAIL:", m, "(did not throw)"); }
  catch (e) { if (re.test(e.message)) pass++; else { fail++; console.log("FAIL:", m, "(wrong message:", e.message, ")"); } }
};

const CTX = {
  projects: ["OPS", "SUP", "APPROVALS"],
  serviceDesks: [{ id: "3", queueIds: ["11", "12"] }],
  timeZones: ["UTC", "Europe/Zurich"],
  skillIndex: ["sk1", "sk2", "sk3", "sk4", "sk5"],
};
const base = (over = {}) => ({
  persona: { name: "Nadia" },
  scope: { read: { projects: ["OPS", "SUP"] }, write: { projects: ["OPS"] } },
  cadence: { preset: "every30", timeZone: "Europe/Zurich" },
  ...over,
});
const norm = (over = {}, ctx = CTX) => normalizeVa(base(over), ctx);
const reasonsFor = (r, field) => r.refused.filter((x) => x.field === field).map((x) => x.reason);

/* ── 1. the record shape is the FRAME's shape, after the design fold ───────────── */
{
  const { va, refused } = norm();
  ok(refused.length === 0, `a clean record refuses nothing (${JSON.stringify(refused)})`);
  assert.deepEqual(Object.keys(va).sort(), ["cadence", "guardrails", "intake", "persona", "powers", "scope", "status"]);
  pass++;
  const g = va.guardrails;
  ok("owedPerHour" in g && !("owedUncapped" in g), "the record carries owedPerHour and NOT owedUncapped (F-412)");
  ok("maxWritesPerRun" in g && !("maxBulkTargets" in g), "the record carries maxWritesPerRun and NOT maxBulkTargets (F-425)");
  ok(g.owedPerHour === 12, "owedPerHour defaults to 12");
  ok(g.maxWritesPerRun === limits.JOB_DEFAULT_MAX_WRITES_PER_RUN, "the write brake IS the job write brake, one vocabulary");
  ok(g.shadowTicks === 3 && g.minPostGapMinutes === 15 && g.antiPileUpDays === 4
    && g.otherWriterQuietMinutes === 15 && g.maxItemsPerTick === 5,
    "the FRAME's defaults are the defaults");
  ok(va.status.shadowUntilTick === g.shadowTicks, "a new agent starts inside shadow mode");
  ok(va.powers.replyPublic === false && va.powers.replyInternal === true, "public replies are OFF by default, internal notes ON");
}

/* ── 2. VA_LIMITS is a VIEW of registry-limits, not a second declaration ───────── */
{
  ok(VA_LIMITS.owedPerHour === limits.VA_OWED_PER_HOUR_DEFAULT
    && VA_CEILINGS.capsPerHour.max === limits.VA_CAPS_PER_HOUR_MAX
    && VA_LIMITS.attemptsCap === limits.VA_ITEM_ATTEMPTS_MAX
    && VA_LIMITS.itemTtlDays === limits.VA_ITEM_TTL_DAYS
    && VA_LIMITS.itemRowCap === limits.VA_ITEM_ROW_CAP
    && VA_LIMITS.memoryCompactBytes === limits.VA_MEMORY_COMPACT_BYTES
    && VA_LIMITS.memoryCapBytes === limits.VA_MEMORY_MAX_BYTES
    && VA_LIMITS.constraintMaxBytes === limits.VA_CONSTRAINT_MAX_BYTES
    && VA_LIMITS.healthBannerFailedTicks === limits.VA_HEALTH_BANNER_FAILED_TICKS
    && VA_CEILINGS.maxWritesPerRun.max === limits.JOB_MAX_WRITES_PER_RUN
    && VA_LIMITS.skillIds === limits.MAX_RULE_SKILL_IDS,
    "VA_LIMITS / VA_CEILINGS mirror registry-limits exactly");
  // THE LEDGER'S CONTRACT (1.5 commit 2). `src/va-ledger.js` and `src/shared/va-keys.js`
  // clamp against these member names; a rename or a nested value there becomes a silent
  // NaN in a TTL or a row cap, so the names AND the flatness are asserted here.
  const LEDGER_MEMBERS = {
    itemTtlDays: 90, tickTtlDays: 7, effectTtlDays: 30, itemRowCap: 400, attemptsCap: 3,
    memoryCompactBytes: 6144, memoryCapBytes: 8192, stagedBodyMaxChars: 2000,
    constraintsMax: 20, constraintMaxBytes: 280, maxItemsPerTick: 5,
    capsPerHour: 6, capsPerDay: 40, owedPerHour: 12, minPostGapMinutes: 15,
    antiPileUpDays: 4, otherWriterQuietMinutes: 15, shadowTicks: 3,
    historyMax: 10, notesMaxChars: 600,
  };
  for (const [k, v] of Object.entries(LEDGER_MEMBERS)) {
    ok(VA_LIMITS[k] === v, `VA_LIMITS.${k} is the flat number ${v} (got ${JSON.stringify(VA_LIMITS[k])})`);
  }

  /*
   * F-498 — THE PINNED BUDGET IS IN THE SAME UNIT AS THE CAP, AND FITS UNDER IT.
   *
   * A character cap on the pinned half and a byte cap on the row is how a CJK tenant
   * reached a memory it could never write to. This asserts the ARITHMETIC the two numbers
   * are chosen by, so raising either one without the other fails here rather than on a
   * Japanese customer's agent: the whole pinned half, at maximum, must leave the prose
   * real room under `memoryCapBytes` and must not sit permanently over the compaction
   * trigger. (~100 bytes is the envelope: 19 commas, the brackets and the three key names.)
   */
  const pinnedWorstCase = VA_LIMITS.constraintsMax * VA_LIMITS.constraintMaxBytes + 100;
  ok(pinnedWorstCase < VA_LIMITS.memoryCompactBytes,
    `VA_LIMITS: the whole pinned half (${pinnedWorstCase}B) stays under memoryCompactBytes (${VA_LIMITS.memoryCompactBytes}B) — a fully pinned agent is not permanently compacting`);
  ok(VA_LIMITS.memoryCapBytes - pinnedWorstCase >= 2048,
    `VA_LIMITS: …and leaves >=2 KB of the cap for prose (${VA_LIMITS.memoryCapBytes - pinnedWorstCase}B)`);
  ok(Object.values(VA_LIMITS).every((v) => typeof v === "number"), "every VA_LIMITS member is a NUMBER, never an object");
  ok(Object.isFrozen(VA_LIMITS) && Object.isFrozen(VA_CEILINGS) && Object.isFrozen(VA_DEFAULTS), "the shared tables are frozen");
  ok(typeof limits.vaRefusalText === "function"
    && limits.vaRefusalText("caps-owed", 12).includes("12")
    && limits.vaRefusalText("caps-hour", 6) !== limits.vaRefusalText("caps-day", 6),
    "every VA brake has its own refusal sentence, from the one home");
  ok(VA_ITEM_STATES.length === 8 && VA_ITEM_STATES.includes("parked"), "the item state vocabulary is complete");
}

/* ── 3. REFUSALS ──────────────────────────────────────────────────────────────── */
throws(() => normalizeVa({ ...base(), scope: { read: { site: true }, write: { site: true } } }, CTX),
  /scope\.write\.site is refused/, "REFUSE a site-wide write scope");
throws(() => normalizeVa({ persona: { name: "" } }, CTX), /persona\.name is required/, "REFUSE a nameless agent");
throws(() => normalizeVa({ persona: { name: "<<<>>> **" } }, CTX), /persona\.name is required/, "REFUSE a name that is nothing but illegal characters");
throws(() => normalizeVa(base({ cadence: { preset: "custom", cron: "not a cron" } }), CTX), /cadence\.cron is invalid/, "REFUSE an unparseable cron");
throws(() => normalizeVa(base({ cadence: { preset: "custom" } }), CTX), /cadence\.cron is required/, "REFUSE a custom cadence with no cron");
{
  const r = norm({ guardrails: { owedUncapped: true, maxBulkTargets: 5 } });
  ok(reasonsFor(r, "guardrails.owedUncapped").some((x) => /owedPerHour/.test(x)),
    "DROP owedUncapped with a named reason that points at owedPerHour (F-412)");
  ok(reasonsFor(r, "guardrails.maxBulkTargets").some((x) => /maxWritesPerRun/.test(x)),
    "DROP maxBulkTargets with a named reason that points at maxWritesPerRun (F-425)");
  ok(!("owedUncapped" in r.va.guardrails) && !("maxBulkTargets" in r.va.guardrails), "neither dropped field survives into the record");
  // Even `owedUncapped:false` is reported: the operator must learn the field is gone.
  ok(normalizeVa(base({ guardrails: { owedUncapped: false } }), CTX).refused.some((x) => x.field === "guardrails.owedUncapped"),
    "a FALSE owedUncapped is refused too, because the field itself no longer exists");
}
{
  const r = norm({ powers: { deleteIssues: true, changeWorkflow: true, replyPublic: true } });
  ok(reasonsFor(r, "powers.deleteIssues").length === 1 && reasonsFor(r, "powers.changeWorkflow").length === 1,
    "an unknown power is refused BY NAME");
  ok(!("deleteIssues" in r.va.powers) && r.va.powers.replyPublic === true, "unknown powers are dropped, known ones kept");
  // `skillIds` and `confluenceSpaces` are LISTS, not flags: they are not in VA_POWERS
  // (which is the closed set of booleans) but they are part of the powers block.
  ok(Object.keys(r.va.powers).sort().join(",") === [...VA_POWERS, "skillIds", "confluenceSpaces"].sort().join(","), "the power set is closed");
  ok(!Object.keys(r.va.powers).some((k) => /workflow|scheme|permission|role|admin|config/i.test(k)),
    "there is no configuration-write power at all — configuration has no action, so it has no flag");
}

/* ── 4. CLAMPS, both ends, restrictive fallback ────────────────────────────────── */
{
  const hi = norm({ guardrails: {
    capsPerHour: 9999, capsPerDay: 9999, owedPerHour: 9999, shadowTicks: 9999,
    minPostGapMinutes: 99999, antiPileUpDays: 9999, otherWriterQuietMinutes: 99999,
    maxItemsPerTick: 9999, maxWritesPerRun: 99999,
  } }).va.guardrails;
  ok(hi.capsPerHour === limits.VA_CAPS_PER_HOUR_MAX
    && hi.capsPerDay === limits.VA_CAPS_PER_DAY_MAX
    && hi.owedPerHour === limits.VA_OWED_PER_HOUR_MAX
    && hi.shadowTicks === limits.VA_SHADOW_TICKS_MAX
    && hi.minPostGapMinutes === limits.VA_MIN_POST_GAP_MINUTES_MAX
    && hi.antiPileUpDays === limits.VA_ANTI_PILE_UP_DAYS_MAX
    && hi.otherWriterQuietMinutes === limits.VA_OTHER_WRITER_QUIET_MINUTES_MAX
    && hi.maxItemsPerTick === limits.VA_MAX_ITEMS_PER_TICK_MAX
    && hi.maxWritesPerRun === limits.JOB_MAX_WRITES_PER_RUN,
    "every number clamps at the TOP end");
  const lo = norm({ guardrails: {
    capsPerHour: -5, capsPerDay: -5, owedPerHour: -5, shadowTicks: -5,
    minPostGapMinutes: 0, antiPileUpDays: -5, otherWriterQuietMinutes: -5,
    maxItemsPerTick: 0, maxWritesPerRun: -5,
  } }).va.guardrails;
  ok(lo.capsPerHour === 0 && lo.capsPerDay === 0 && lo.owedPerHour === 0 && lo.shadowTicks === 0
    && lo.antiPileUpDays === 0 && lo.otherWriterQuietMinutes === 0 && lo.maxWritesPerRun === 0,
    "every number clamps at the BOTTOM end, and zero is a meaningful value");
  ok(lo.minPostGapMinutes === limits.VA_MIN_POST_GAP_MINUTES_MIN, "the post gap has a FLOOR: it cannot be disabled");
  ok(lo.maxItemsPerTick === 1, "a tick always opens at least one item");
  const r = norm({ guardrails: { capsPerHour: 9999 } });
  ok(reasonsFor(r, "guardrails.capsPerHour").some((x) => /outside the allowed range/.test(x)), "a clamp is REPORTED, never silent");

  // Junk falls back to the DEFAULT, never to the maximum.
  for (const junk of ["", "  ", "abc", null, undefined, true, {}, [], NaN]) {
    const g = norm({ guardrails: { capsPerHour: junk, owedPerHour: junk } }).va.guardrails;
    ok(g.capsPerHour === limits.VA_CAPS_PER_HOUR_DEFAULT && g.owedPerHour === limits.VA_OWED_PER_HOUR_DEFAULT,
      `junk cap (${JSON.stringify(junk)}) falls back to the default, not the maximum`);
  }
  ok(norm({ guardrails: { maxWritesPerRun: 0 } }).va.guardrails.maxWritesPerRun === 0,
    "a deliberate zero write budget survives (read-and-propose agent)");
  ok(norm({ guardrails: { maxWritesPerRun: "" } }).va.guardrails.maxWritesPerRun === limits.JOB_DEFAULT_MAX_WRITES_PER_RUN,
    "a BLANK write budget is the default, not zero");
  ok(norm({ guardrails: { capsPerHour: "7" } }).va.guardrails.capsPerHour === 7, "a numeric string is accepted");
  ok(norm({ guardrails: { capsPerHour: 7.9 } }).va.guardrails.capsPerHour === 7, "a fraction truncates, never rounds up");
}

/* ── 5. persona ───────────────────────────────────────────────────────────────── */
{
  ok(clampPersonaName("Nadia") === "Nadia", "a plain name survives");
  ok(clampPersonaName("Ana-Maria O'Neill Jr.") === "Ana-Maria O'Neill Jr.", "accents, hyphens, apostrophes and dots are legal");
  ok(clampPersonaName("Zoë Müller") === "Zoë Müller", "non-ASCII letters are legal");
  ok(clampPersonaName("Bo<<<>>>b") === "Bob" && !/[<>]/.test(clampPersonaName("Bo<<<FENCE>>>b")),
    "fence characters cannot reach a prompt through the name");
  ok(clampPersonaName("A\nB") === "AB" && !/\n/.test(clampPersonaName("A\nB")), "a newline cannot reach outward text through the name");
  ok(clampPersonaName("**Nadia**") === "Nadia", "markdown cannot reach outward text through the name");
  ok(clampPersonaName("x".repeat(200)).length === VA_PERSONA_NAME_MAX, "the name is length-clamped");
  const r = normalizeVa({ ...base(), persona: { name: "Nadia <script>" } }, CTX);
  ok(r.va.persona.name === "Nadia script" && reasonsFor(r, "persona.name").length === 1, "a reduced name is reported");
  const v = normalizeVa({ ...base(), persona: { name: "Nadia", voice: { register: "shouty", language: "kl", maxSentences: 99, greeting: "yes" } } }, CTX);
  ok(v.va.persona.voice.register === "plain" && v.va.persona.voice.language === "auto", "unknown register/language fall back to the closed-set default");
  ok(v.va.persona.voice.maxSentences === 6, "maxSentences clamps to the ceiling");
  ok(v.va.persona.voice.greeting === false, "a non-boolean greeting is the restrictive default");
  ok(reasonsFor(v, "persona.voice.register").length === 1 && reasonsFor(v, "persona.voice.language").length === 1, "both fallbacks are reported");
  ok(VA_REGISTERS.length === 3 && VA_LANGUAGES.length === 3, "the closed sets are what the wizard renders");
}

/* ── 6. scope, against the live project list ──────────────────────────────────── */
{
  const r = normalizeVa({ ...base(), scope: { read: { projects: ["OPS", "NOPE", "ops", "bad key", "SUP"] }, write: { projects: ["OPS", "SUP"] } } }, CTX);
  ok(r.va.scope.read.projects.join(",") === "OPS,SUP", "unknown and malformed project keys are dropped, case is normalised");
  ok(reasonsFor(r, "scope.read.projects").length === 2, "each dropped key is reported");
  const w = normalizeVa({ ...base(), scope: { read: { projects: ["OPS"] }, write: { projects: ["OPS", "SUP"] } } }, CTX);
  ok(w.va.scope.write.projects.join(",") === "OPS", "the write scope cannot exceed the read scope");
  ok(reasonsFor(w, "scope.write.projects").some((x) => /cannot write where it cannot read/.test(x)), "…and says why");
  const site = normalizeVa({ ...base(), scope: { read: { site: true }, write: { projects: ["OPS"] } } }, CTX);
  ok(site.va.scope.read.site === true && site.va.scope.read.projects.length === 0, "a site-wide READ scope is allowed and carries no list");
  ok(site.va.scope.write.projects.join(",") === "OPS", "a site-wide read does not widen the write scope");
  const none = normalizeVa({ ...base(), scope: { read: { projects: ["OPS"] }, write: {} } }, CTX);
  ok(none.va.scope.write.projects.length === 0, "no write scope is a legal, read-only agent");
  // With no project list supplied the module can only check SHAPE — the resolver owns
  // the live check. Proven here so nobody assumes this module did it.
  const shapeOnly = normalizeVa({ ...base(), scope: { read: { projects: ["ZZZ", "nope key"] }, write: { projects: ["ZZZ"] } } }, {});
  ok(shapeOnly.va.scope.read.projects.join(",") === "ZZZ", "without a project list, keys are shape-checked only");
  ok(VA_PROJECT_KEY_RE.test("OPS") && !VA_PROJECT_KEY_RE.test("O"), "the project key shape is the Jira one");
}

/* ── 7. intake ────────────────────────────────────────────────────────────────── */
{
  const r = normalizeVa({ ...base(), intake: {
    serviceDesks: [{ serviceDeskId: "3", queueIds: ["11", "99", "bad/id"] }, { serviceDeskId: "7", queueIds: [] }, { serviceDeskId: "../../etc" }],
    jql: '  project = OPS AND status = "Waiting for support"  ',
    mentionsOf: ["557058:abc-123", "not a valid id!", "557058:abc-123"],
    owedFirst: false,
  } }, CTX);
  ok(r.va.intake.serviceDesks.length === 1 && r.va.intake.serviceDesks[0].queueIds.join(",") === "11",
    "unknown desks and queues are dropped against the live lists");
  ok(reasonsFor(r, "intake.serviceDesks").length === 4, "every dropped desk and queue is reported (one unknown queue, one malformed queue, one unknown desk, one malformed desk)");
  ok(r.va.intake.mentionsOf.length === 1, "malformed account ids are dropped and duplicates collapse");
  ok(r.va.intake.jql === 'project = OPS AND status = "Waiting for support"', "the JQL is trimmed and passed through UNPARSED");
  ok(r.va.intake.owedFirst === false, "owedFirst is an honest boolean");
  const long = normalizeVa({ ...base(), intake: { jql: "x".repeat(VA_JQL_MAX + 100) } }, CTX);
  ok(long.va.intake.jql.length === VA_JQL_MAX && reasonsFor(long, "intake.jql").length === 1, "an over-long JQL is cut and reported");
  const bad = normalizeVa({ ...base(), intake: { jql: { evil: true } } }, CTX);
  ok(bad.va.intake.jql === "" && reasonsFor(bad, "intake.jql").length === 1, "a non-string JQL is cleared, not stringified");
  // The dry `search` that proves a JQL is executable is the RESOLVER's (F-424): this
  // module does no I/O, so a nonsense JQL passes through here by design.
  ok(normalizeVa({ ...base(), intake: { jql: "this is not jql at all" } }, CTX).va.intake.jql === "this is not jql at all",
    "an unexecutable JQL is NOT caught here — the resolver's dry search is the gate (F-424)");
}

/* ── 8. cadence, reusing cron.js ──────────────────────────────────────────────── */
{
  const r = norm();
  ok(r.va.cadence.cron === "*/30 * * * *" && validateCron(r.va.cadence.cron).ok, "a preset renders its cron through presetToCron");
  ok(r.va.cadence.timeZone === "Europe/Zurich", "a supported zone is kept");
  ok(norm({ cadence: { preset: "every30", timeZone: "Mars/Olympus" } }).va.cadence.timeZone === "UTC", "an unknown zone falls back to UTC");
  ok(reasonsFor(norm({ cadence: { preset: "every30", timeZone: "Mars/Olympus" } }), "cadence.timeZone").length === 1, "…and says so");
  const custom = norm({ cadence: { preset: "custom", cron: "7 */4 * * *", timeZone: "UTC" } });
  ok(custom.va.cadence.cron === "7 */4 * * *" && custom.va.cadence.preset === "every4h",
    "a cron that IS a preset is renamed to that preset, so the UI never shows Custom for a known shape");
  const daily = norm({ cadence: { preset: "daily", cron: "30 7 * * *", timeZone: "UTC" } });
  ok(daily.va.cadence.cron === "30 7 * * *", "a stored cron that still matches its preset is KEPT (hour/minute are not in the record)");
  ok(cronToPreset(daily.va.cadence.cron).preset === "daily", "…and still round-trips through cron.js");
  const bogus = norm({ cadence: { preset: "fortnightly" } });
  ok(bogus.va.cadence.preset === VA_DEFAULTS.cadence.preset && reasonsFor(bogus, "cadence.preset").length === 1, "an unknown preset falls back and is reported");
  const w = norm({ cadence: { preset: "hourly", timeZone: "UTC", postWindow: { days: [9, 1, 1, 3, -2], from: "25:00", to: "17:30" } } }).va.cadence.postWindow;
  ok(w.days.join(",") === "1,3", "post-window days are filtered and de-duplicated, never clamped into a different day");
  ok(w.from === "00:00" && w.to === "17:30", "a malformed time of day falls back to the open end");
  const empty = norm({ cadence: { preset: "hourly", timeZone: "UTC", postWindow: { days: [] } } }).va.cadence.postWindow;
  ok(empty.days.length === 7, "no days listed means NO RESTRICTION, never never");
}

/* ── 8b. powers.confluenceSpaces (1.5 commit 4c) ──────────────────────────────── */
{
  const r = norm({ powers: { confluenceWrite: true, confluenceSpaces: ["eng", "ENG", "~alice", "not a key!", { key: "hr" }] } });
  ok(r.va.powers.confluenceSpaces.join(",") === "ENG,~ALICE,HR", "space keys are upper-cased, de-duplicated and object-or-string");
  ok(reasonsFor(r, "powers.confluenceSpaces").some((x) => /not a key/.test(x)), "a malformed space key is reported by name");
  ok(norm({ powers: { confluenceWrite: true, confluenceSpaces: Array.from({ length: 30 }, (_, i) => `S${i}`) } }).va.powers.confluenceSpaces.length === VA_CONFLUENCE_SPACES_MAX,
    "the space list is capped");
  // WRITING ON WITH NO SPACE is a reported clamp, not a refused save: the wizard sets
  // the power and the spaces in two steps.
  ok(reasonsFor(norm({ powers: { confluenceWrite: true } }), "powers.confluenceSpaces").some((x) => /cannot write to it/.test(x)),
    "confluenceWrite with no space says the agent cannot write");
  // vaConfluenceSpaces: the POWER is the first gate. A list left behind by a power that
  // was switched off must not still authorise anything.
  ok(vaConfluenceSpaces(norm({ powers: { confluenceWrite: true, confluenceSpaces: ["ENG"] } }).va).join(",") === "ENG", "vaConfluenceSpaces reads the list");
  ok(vaConfluenceSpaces(norm({ powers: { confluenceWrite: false, confluenceSpaces: ["ENG"] } }).va).length === 0, "vaConfluenceSpaces.BLOCK_power_off");
  ok(vaConfluenceSpaces(null).length === 0 && vaConfluenceSpaces({}).length === 0, "vaConfluenceSpaces never throws on a junk record");
}

/* ── 9. powers.skillIds ───────────────────────────────────────────────────────── */
{
  const r = norm({ powers: { skillIds: ["sk1", "sk2", "sk3", "sk4", "sk5", "sk1", "ghost"] } });
  ok(r.va.powers.skillIds.length === limits.MAX_RULE_SKILL_IDS, "at most four skills are bound");
  ok(r.va.powers.skillIds.join(",") === "sk1,sk2,sk3,sk4", "the first four win and duplicates collapse");
  ok(reasonsFor(r, "powers.skillIds").some((x) => /at most 4 skills/.test(x)), "the fifth is reported");
  ok(reasonsFor(r, "powers.skillIds").some((x) => /ghost/.test(x)), "a skill that no longer exists is reported by id");
  ok(norm({ powers: { skillIds: ["sk1", "../../evil"] } }, {}).va.powers.skillIds.join(",") === "sk1", "a malformed skill id is dropped even without an index");
}

/* ── 10. approval inbox ───────────────────────────────────────────────────────── */
{
  ok(norm({ guardrails: { approvalProjectKey: "approvals" } }).va.guardrails.approvalProjectKey === "APPROVALS", "the approval project key is upper-cased");
  const gone = norm({ guardrails: { approvalProjectKey: "GHOST" } });
  ok(gone.va.guardrails.approvalProjectKey === "" && reasonsFor(gone, "guardrails.approvalProjectKey").length === 1,
    "an approval inbox that does not exist is cleared and reported, so proposals fall back to an internal note");
}

/* ── 11. ROUND-TRIP STABILITY ─────────────────────────────────────────────────── */
{
  const messy = {
    persona: { name: "  Nadia <b>  ", voice: { register: "warm", greeting: true, maxSentences: 99, language: "de" }, signature: true },
    scope: { read: { projects: ["ops", "SUP", "GHOST"] }, write: { projects: ["OPS"] } },
    intake: { serviceDesks: [{ serviceDeskId: "3", queueIds: ["11", "99"] }], jql: "  project = OPS  ", mentionsOf: ["557058:abc"], owedFirst: true },
    cadence: { preset: "daily", cron: "30 7 * * *", timeZone: "Europe/Zurich", postWindow: { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" } },
    powers: { replyPublic: true, transition: true, skillIds: ["sk1", "sk2"], nonsense: true },
    guardrails: { capsPerHour: 4, capsPerDay: 4000, owedPerHour: 9, shadowTicks: 2, minPostGapMinutes: 20, antiPileUpDays: 2, otherWriterQuietMinutes: 30, approvalProjectKey: "approvals", maxItemsPerTick: 3, maxWritesPerRun: 25, owedUncapped: true, maxBulkTargets: 9 },
    status: { paused: true, shadowUntilTick: 12 },
  };
  const once = normalizeVa(messy, CTX);
  const twice = normalizeVa(once.va, CTX);
  assert.deepEqual(twice.va, once.va);
  pass++;
  ok(twice.refused.length === 0, `the second pass refuses NOTHING new (${JSON.stringify(twice.refused)})`);
  ok(once.refused.length >= 4, "the first pass reported every repair it made");
  const thrice = normalizeVa(twice.va, CTX);
  assert.deepEqual(thrice.va, once.va);
  pass++;
  // And the defaults are themselves a fixed point (a default that normalises to
  // something else is a default nobody actually gets).
  const d = normalizeVa({ ...VA_DEFAULTS, persona: { ...VA_DEFAULTS.persona, name: "Nadia" } }, {});
  assert.deepEqual(normalizeVa(d.va, {}).va, d.va);
  pass++;
  ok(d.refused.length === 0, `VA_DEFAULTS normalise without a single repair (${JSON.stringify(d.refused)})`);
}

/* ── 12. renderGuardrailSentences — the ONE renderer (F-420 class) ─────────────── */
{
  const { va } = norm({ powers: { replyPublic: false, transition: true }, guardrails: { capsPerHour: 6, capsPerDay: 40, approvalProjectKey: "APPROVALS" } });
  const s = renderGuardrailSentences(va);
  ok(Array.isArray(s) && s.length >= 10, "the sentences are a list the prompt and the review card both render");
  const text = s.join(" ");
  ok(text.includes("Nadia") && text.includes("OPS"), "the sentences are rendered FROM THE RECORD, not authored");
  ok(/internal note/i.test(text), "a no-public-reply agent is told so");
  ok(/6 times an hour/.test(text) && /40 a day/.test(text) && /12 an hour/.test(text), "the caps in the sentences are the caps in the record");
  ok(/APPROVALS/.test(text), "the approval inbox is named");
  ok(/cannot change configuration/i.test(text), "the configuration guarantee is stated");
  ok(!/[—–]|\*\*|^- /m.test(text), "the sentences carry no markdown and no em dash (they are outward-shaped prose)");
  // The sentences MOVE when the record moves. A renderer that ignores its input is the
  // exact defect having one renderer is supposed to prevent.
  const pub = renderGuardrailSentences(norm({ powers: { replyPublic: true } }).va).join(" ");
  ok(/portal/i.test(pub) && pub !== text, "turning on public replies changes the sentences");
  const noWrite = renderGuardrailSentences(norm({ scope: { read: { projects: ["OPS"] }, write: { projects: [] } } }).va).join(" ");
  ok(/may not change any issue/i.test(noWrite), "a read-only agent is told it may not change anything");
  // It never throws on a partial record: the wizard renders a preview mid-interview.
  ok(renderGuardrailSentences(null).length >= 10 && renderGuardrailSentences({}).length >= 10, "a partial record still renders (the wizard preview fails OPEN)");
}

/* ── 13. vaWriteScope — the dispatcher's context (F-411) ──────────────────────── */
{
  const { va } = norm();
  const ws = vaWriteScope(va);
  assert.deepEqual(ws, { projects: ["OPS"] });
  pass++;
  ok(Object.keys(ws).join(",") === "projects", "the context carries the write scope and NOTHING else — intake can never widen it");
  assert.deepEqual(vaWriteScope(normalizeVa({ ...base(), scope: { read: { site: true }, write: { projects: [] } } }, CTX).va), { projects: [] });
  pass++;
  // An ABSENT scope is an EMPTY list, never "everything". This is the whole gate.
  for (const junk of [null, undefined, {}, { scope: {} }, { scope: { write: { site: true } } }, "OPS", 42]) {
    assert.deepEqual(vaWriteScope(junk), { projects: [] });
    pass++;
  }
  assert.deepEqual(vaWriteScope({ scope: { write: { projects: ["ops", "OPS", "bad key", { key: "SUP" }] } } }), { projects: ["OPS", "SUP"] });
  pass++;
}

/* ── 14. mergeVaPatch — null in a patch means KEEP, never "reset" (F-492) ─────── */
{
  // The stored record is a TIGHTENED, PAUSED agent: every value below differs from the
  // default, so anything that quietly rebuilds from VA_DEFAULTS is visible here.
  const stored = norm({
    guardrails: { capsPerHour: 2, capsPerDay: 9, shadowTicks: 7 },
    status: { paused: true, shadowUntilTick: 41 },
    powers: { skillIds: ["sk1", "sk2"] },
  }).va;
  stored.status.paused = true; // normalizeVa keeps it; assert the premise before relying on it.
  ok(stored.status.paused === true && stored.guardrails.capsPerHour === 2, "the fixture really is a paused, tightened agent");

  const merged = (patch) => normalizeVa(mergeVaPatch(stored, patch), CTX);

  // A whole sub-object sent as null. This is the F-492 shape: `normalizeVa` reads null
  // as absent and rebuilds from VA_DEFAULTS, which RESUMES the agent.
  {
    const { va, refused } = merged({ persona: { name: "Ada" }, status: null });
    ok(va.status.paused === true, "status:null leaves a paused agent PAUSED (F-492)");
    ok(va.status.shadowUntilTick === 41, "status:null leaves shadow mode where it was");
    ok(va.persona.name === "Ada", "the rest of the patch still applies");
    ok(refused.length === 0, `a null sub-object is not a refusal, it is a no-op (${JSON.stringify(refused)})`);
  }
  {
    const { va } = merged({ guardrails: null });
    ok(va.guardrails.capsPerHour === 2 && va.guardrails.capsPerDay === 9,
      "guardrails:null keeps every tightened cap (F-492)");
  }

  // A single scalar field sent as null inside a real sub-object.
  {
    const { va } = merged({ guardrails: { capsPerHour: null } });
    ok(va.guardrails.capsPerHour === 2, "guardrails.capsPerHour:null leaves the cap alone (F-492)");
    ok(va.guardrails.capsPerDay === 9, "and its siblings are untouched");
  }
  {
    const { va } = merged({ status: { paused: null } });
    ok(va.status.paused === true, "status.paused:null does not un-pause");
  }

  // Scope is the permission case: a null must never WIDEN what the agent may write.
  {
    const { va } = merged({ scope: { write: null } });
    assert.deepEqual(vaWriteScope(va), { projects: ["OPS"] });
    pass++;
  }
  {
    const { va } = merged({ scope: { write: { projects: null } } });
    assert.deepEqual(vaWriteScope(va), { projects: ["OPS"] });
    pass++;
  }
  // …but an EMPTY ARRAY is a sent value and still means "none". That is the one case
  // null is deliberately NOT a synonym for.
  {
    const { va } = merged({ scope: { write: { projects: [] } } });
    assert.deepEqual(vaWriteScope(va), { projects: [] });
    pass++;
    ok(mergeVaPatch(stored, { powers: { skillIds: [] } }).powers.skillIds.length === 0,
      "an empty allow-list still means none");
    assert.deepEqual(mergeVaPatch(stored, { powers: { skillIds: null } }).powers.skillIds, ["sk1", "sk2"]);
    pass++;
  }

  // undefined behaves as null (a serialiser that drops undefined never gets here, but
  // an in-process caller can hand one over).
  ok(mergeVaPatch(stored, { status: undefined }).status.paused === true, "undefined keeps existing too");

  // Arrays and non-objects on the LEFT are still replaceable by a real value: "keep"
  // is a property of the PATCH being empty, not of the existing value's type.
  assert.deepEqual(mergeVaPatch({ a: 1, b: { c: 2 } }, { a: 5, b: { c: null, d: 3 } }), { a: 5, b: { c: 2, d: 3 } });
  pass++;
  assert.deepEqual(mergeVaPatch({ a: 1 }, { a: false }), { a: false });
  pass++;
  ok(mergeVaPatch({ a: 1 }, { a: 0 }).a === 0, "0 and false are SENT values, not absences");
  // The merge never mutates the stored record.
  ok(stored.status.paused === true && stored.guardrails.capsPerHour === 2, "mergeVaPatch did not mutate the stored record");
}

console.log(`VA CONFIG: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
