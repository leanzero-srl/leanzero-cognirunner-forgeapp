/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/va-wizard.js — the setup interview as a pure state
// machine (release 1.5, commit 5a). Auto-discovered by run-offline.mjs.
//
// The properties, in order of what a regression would cost:
//   1. THE MODEL CANNOT STEER. A bogus `field`, an early `done`, a 10,000-entry `options`
//      array and an oversized `say` all fail to move the machine or to reach a record.
//   2. EVERY REFUSAL IS NAMED. A project, queue, skill, time zone, cadence or power the
//      catalogue does not carry is refused with a sentence, never accepted.
//   3. WRITE IS NEVER SITE-WIDE, and the refusal is normalizeVa's own sentence.
//   4. ONE RECORD, TWO DOORS. The same answers through the machine and through a direct
//      normalizeVa call produce byte-identical records.
//   5. THE STATE IS STORABLE. JSON-serialisable, catalogue stripped, under 8 KB.
// Run: node scripts/va-wizard.test.mjs
import {
  createWizard, stepWizard, resumeWizard, serializeWizardState, buildVaRecord,
  catalogToCtx, checkJqlShape, clampSay, renderVoiceSamples, renderReviewSummary,
  writeSiteRefusalReason, optionsForStep, wizardResumeInfo, WIZARD_QUESTION_COUNT,
  WIZARD_STEPS, VOICE_SAMPLE_CHIPS, VA_WIZARD_SAY_MAX, VA_WIZARD_STATE_MAX_BYTES,
  VA_WIZARD_VERSION,
} from "../../src/shared/va-wizard.js";
import {
  normalizeVa, VA_DEFAULTS, VA_SUGGESTED_POST_WINDOW, VA_DEFAULT_MARK, VA_DEFAULT_FOOTNOTE, VA_COPY,
  vaSuggestedCadence, resolveDefaultTimeZone, vaPowerPhrase,
} from "../../src/shared/va-config.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const fields = (r) => r.refused.map((x) => x.field);
const refusedOn = (r, field, label) => {
  ok(r.refused.some((x) => x.field === field && typeof x.reason === "string" && x.reason.length > 10),
    `${label} — refused on ${field} with a sentence (got ${JSON.stringify(fields(r))})`);
};

/* ── The catalogue every case is validated against ──────────────────────────── */

const CATALOG = {
  projects: [{ key: "SUP", name: "Support" }, { key: "OPS", name: "Operations" }, { key: "SEC", name: "Security" }],
  serviceDesks: [
    { id: "1", name: "IT help", queues: [{ id: "10", name: "Unassigned", jql: "project = SUP" }, { id: "11", name: "Waiting" }] },
    { id: "2", name: "Facilities", queues: [{ id: "20", name: "New" }] },
  ],
  timeZones: ["UTC", "Europe/Berlin", "Europe/Bucharest"],
  skillIndex: [{ id: "skill_jsm_tone" }, { id: "skill_triage" }],
};

/* ── 0. the step order is in code, and it is the order the FRAME names ─────── */

const ORDER = ["persona_name", "persona_voice", "intake", "read_scope", "write_scope", "cadence", "powers", "guardrails", "review", "create"];
ok(WIZARD_STEPS.map((s) => s.id).join(",") === ORDER.join(","), `the field order is fixed (got ${WIZARD_STEPS.map((s) => s.id).join(",")})`);
ok(WIZARD_STEPS.every((s) => typeof s.field === "string" && typeof s.ask === "string" && s.ask.length > 10), "every step names a record field and carries a code-authored question");

/* ── 1. the happy path, driven entirely through step() ─────────────────────── */

const HAPPY = [
  ["persona_name", "Nadia"],
  ["persona_voice", { register: "plain", maxSentences: 3, greeting: false, signature: true, language: "en" }],
  ["intake", { serviceDesks: [{ serviceDeskId: "1", queueIds: ["10", "11"] }], jql: 'project = SUP AND status = "Waiting for support"', mentionsOf: ["557058:abc-123"], owedFirst: true }],
  ["read_scope", { site: false, projects: ["SUP", "OPS"] }],
  ["write_scope", { projects: ["SUP"] }],
  ["cadence", { preset: "every30", timeZone: "Europe/Berlin", postWindow: { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" } }],
  ["powers", { replyInternal: true, replyPublic: true, transition: true, skillIds: ["skill_jsm_tone"] }],
  ["guardrails", { capsPerHour: 4, capsPerDay: 20, minPostGapMinutes: 10, maxItemsPerTick: 3, maxWritesPerRun: 5, approvalProjectKey: "OPS" }],
  // F-916 - confirming the REVIEW creates. There is no second "Ready to create it?" turn.
  ["review", { confirm: true }],
];

const drive = (answers, catalog = CATALOG) => {
  let { state } = createWizard({ catalog });
  let turn = stepWizard(state, null);
  const turns = [turn];
  for (const [expectStep, answer] of answers) {
    ok(turn.stepId === expectStep, `happy path stands on ${expectStep} (got ${turn.stepId}; refused ${JSON.stringify(fields(turn))})`);
    turn = stepWizard(turn.state, { answer });
    ok(turn.refused.length === 0, `happy path accepts the ${expectStep} answer (refused ${JSON.stringify(turn.refused)})`);
    turns.push(turn);
  }
  return { turn, turns };
};

const happy = drive(HAPPY);
ok(happy.turn.done === true && happy.turn.created === true, "the interview finishes on the review card's confirm");
ok(happy.turn.stepId === "create", "the create step is where it lands, it is just never rendered standing there");
/* F-916 - a caller driving the machine directly may still answer the create step, and the
   step still validates: what went is the extra SCREEN, not the step. */
{
  const again = stepWizard(happy.turn.state, { answer: { confirm: true } });
  ok(again.created === true, "the create step still answers a direct caller");
  const unconfirmed = stepWizard(happy.turn.state, { answer: {} });
  ok(unconfirmed.refused.some((r) => r.field === "create"), "the create step still refuses an unconfirmed answer");
}
ok(happy.turn.va && happy.turn.va.persona.name === "Nadia", "create returns the normalised record");
ok(Array.isArray(happy.turn.refused) && happy.turn.refused.length === 0, `create refuses nothing on the happy path (${JSON.stringify(happy.turn.refused)})`);
ok(happy.turn.va.scope.write.projects.join(",") === "SUP", "the write scope survived");
ok(happy.turn.va.powers.skillIds.join(",") === "skill_jsm_tone", "the skill binding survived");
ok(happy.turn.va.cadence.timeZone === "Europe/Berlin", "the time zone survived");
ok(happy.turn.va.guardrails.approvalProjectKey === "OPS", "the approval inbox survived");

/* the opening turn asks the first question with the CODE's words */
ok(happy.turns[0].stepId === "persona_name" && happy.turns[0].prompt === WIZARD_STEPS[0].ask, "the opening turn renders the code-authored question");

/* purity: step() never mutates the state it was handed */
{
  const { state } = createWizard({ catalog: CATALOG });
  const snapshot = JSON.stringify(state);
  stepWizard(state, { answer: "Nadia" });
  ok(JSON.stringify(state) === snapshot, "step() does not mutate the state it was given");
}

/* ── 2. the review step renders BOTH the guardrail sentences and a plain summary ── */

{
  const review = happy.turns[happy.turns.length - 2];
  ok(review.stepId === "create" || review.summary, "the review turn carries a summary");
  const atReview = happy.turns[8];
  ok(atReview.stepId === "review", `turn 8 is the review step (got ${atReview.stepId})`);
  ok(Array.isArray(atReview.guardrailSentences) && atReview.guardrailSentences.length >= 10, "the review renders the guardrail sentences");
  ok(atReview.guardrailSentences.some((s) => s.includes("SUP")), "the guardrail sentences name the write scope");
  ok(Array.isArray(atReview.summary) && atReview.summary.length >= 5, "the review renders a plain-sentence summary");
  const all = [...atReview.summary, ...atReview.guardrailSentences].join("\n");
  ok(!/^[ \t]*[-*+•]/m.test(all) && !/\*\*/.test(all) && !/`/.test(all), "the review card is plain prose (no bullets, no bold, no backticks)");
  ok(atReview.summary.some((s) => s.includes("Nadia")), "the summary names the agent");
}

/* ── 2b. F-916 — what the card SAYS, and what a new agent STARTS with ────── */

{
  /* THE STARTING POINT IS ONE HOME, and since F-953 the record's own fallback is the SAME
     window: a path that skips the cadence step used to ship Sun-Sat 00:00-23:59 silently.
     "No restriction" is still expressible, but only by SAYING so (an explicitly empty day
     list) - that half is asserted in va-config.test.mjs, against normalizeVa itself. */
  ok(VA_SUGGESTED_POST_WINDOW.days.join(",") === "1,2,3,4,5" && VA_SUGGESTED_POST_WINDOW.from === "08:00" && VA_SUGGESTED_POST_WINDOW.to === "18:00",
    "the suggested posting window is the working week, working hours");
  ok(VA_DEFAULTS.cadence.postWindow.days.join(",") === "1,2,3,4,5" && VA_DEFAULTS.cadence.postWindow.from === "08:00",
    `the record's own fallback is the working week too (got ${JSON.stringify(VA_DEFAULTS.cadence.postWindow)})`);
  const skipped = normalizeVa({ persona: { name: "Ada" } }, catalogToCtx(CATALOG)).va;
  ok(skipped.cadence.postWindow.days.join(",") === "1,2,3,4,5" && skipped.cadence.postWindow.from === "08:00" && skipped.cadence.postWindow.to === "18:00",
    `an agent whose cadence step was never answered does not post at 3am on a Sunday (got ${JSON.stringify(skipped.cadence.postWindow)})`);

  /* the zone: the viewer's when the site offers it, UTC when it does not, and never the
     first entry of an alphabetical zone list (which is how "Africa/Abidjan" happened). */
  ok(resolveDefaultTimeZone("Europe/Bucharest", null, CATALOG.timeZones) === "Europe/Bucharest", "the viewer's zone is the default when the site offers it");
  ok(resolveDefaultTimeZone("Pacific/Palau", null, CATALOG.timeZones) === "UTC", "a viewer zone the site does not offer falls back to UTC, not to the list's first entry");
  ok(resolveDefaultTimeZone("", "Europe/Berlin", CATALOG.timeZones) === "Europe/Berlin", "the site's zone is the second choice");
  ok(resolveDefaultTimeZone("", "", CATALOG.timeZones) === "UTC", "with neither, it is UTC");
  ok(resolveDefaultTimeZone("Not/AZone", "", null) === "UTC", "a zone that is not a zone is never the default");
  ok(vaSuggestedCadence({ viewer: "Europe/Berlin", allowed: CATALOG.timeZones }).timeZone === "Europe/Berlin", "the suggested cadence carries the resolved zone");
  ok(vaSuggestedCadence({ viewer: "", allowed: CATALOG.timeZones }).postWindow.from === "08:00", "the suggested cadence carries the suggested window");

  /* the cadence step hands the UI the SAME starting point, so the control cannot seed
     itself from somewhere else. */
  const cad = stepWizard(createWizard({ catalog: CATALOG }).state, null);
  const atCadence = happy.turns[5];
  ok(atCadence.stepId === "cadence", `turn 5 is the cadence step (got ${atCadence.stepId})`);
  ok(atCadence.extras.suggestedPostWindow && atCadence.extras.suggestedPostWindow.from === "08:00", "the cadence turn carries the suggested window");
  ok(typeof atCadence.extras.stagingNote === "string" && /15 minutes/.test(atCadence.extras.stagingNote), "the cadence turn carries the staging note");
  ok(cad.stepId === "persona_name", "a fresh interview still opens on the name");

  /* THE CARD MARKS A VALUE NOBODY CHOSE. */
  const bare = normalizeVa({ persona: { name: "Ada" }, cadence: { postWindow: { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" } } }, catalogToCtx(CATALOG)).va;
  const marked = renderReviewSummary(bare, { defaultTimeZone: "UTC" });
  ok(marked[0].includes(VA_DEFAULT_MARK.trim()), `an untouched cadence line is marked as a default (got ${marked[0]})`);
  ok(marked[0].includes("weekdays"), "the posting days are words, not a seven-name list");
  const chosen = normalizeVa({ persona: { name: "Ada" }, cadence: { preset: "hourly", timeZone: "Europe/Berlin", postWindow: { days: [0, 6], from: "09:00", to: "17:00" } } }, catalogToCtx(CATALOG)).va;
  const chosenCard = renderReviewSummary(chosen, { defaultTimeZone: "UTC" });
  const chosenLine = chosenCard[0];
  ok(!chosenLine.includes(VA_DEFAULT_MARK.trim()), `a chosen cadence line is not marked (got ${chosenLine})`);
  ok(chosenLine.includes("weekends"), "a weekend window says weekends");

  /*
   * F-953 - THE MARKER IS EXPLAINED ONCE, AT THE BOTTOM. Five inline "(default)" tags read
   * as five warnings on a card whose job is to describe one agent.
   */
  ok(!/\(default\)/.test(marked.join(" ")), "the word (default) is not repeated inline any more");
  ok(marked[marked.length - 1] === VA_DEFAULT_FOOTNOTE, `a card with defaults carries the footnote, once, at the end (got ${marked[marked.length - 1]})`);
  ok(marked.filter((s) => s === VA_DEFAULT_FOOTNOTE).length === 1, "the footnote is said once");
  ok(/\*/.test(VA_DEFAULT_FOOTNOTE) && /defaults/.test(VA_DEFAULT_FOOTNOTE), "the footnote explains the star it is footnoting");
  const everything = normalizeVa({
    persona: { name: "Ada" },
    cadence: { preset: "hourly", timeZone: "Europe/Berlin", postWindow: { days: [0, 6], from: "09:00", to: "17:00" } },
    powers: { replyInternal: false, assign: true },
  }, catalogToCtx(CATALOG)).va;
  const noDefaults = renderReviewSummary(everything, { defaultTimeZone: "UTC" });
  ok(!noDefaults.includes(VA_DEFAULT_FOOTNOTE), `a card with nothing marked carries no footnote (got ${noDefaults.join(" | ")})`);
  ok(!noDefaults.some((s) => s.includes(VA_DEFAULT_MARK)), "…and nothing on it carries the star");

  /* PROJECTS BY NAME, when the catalogue has one. */
  const scoped = normalizeVa({ persona: { name: "Ada" }, scope: { read: { projects: ["SUP", "OPS"] }, write: { projects: ["SUP"] } } }, catalogToCtx(CATALOG)).va;
  const named = renderReviewSummary(scoped, { projects: CATALOG.projects }).join(" ");
  ok(named.includes("Support (SUP)") && named.includes("Operations (OPS)"), `the card names projects (got ${named})`);
  const unknown = renderReviewSummary(scoped, { projects: [] }).join(" ");
  ok(unknown.includes("SUP"), "a key with no catalogue row still renders as the key");
}

{
  /* AN AGENT THAT WOULD DO NOTHING IS REFUSED AT THE STEP, not mentioned on the card. */
  const at = (stepId) => {
    let turn = stepWizard(createWizard({ catalog: CATALOG }).state, null);
    for (const [expect, answer] of HAPPY) { if (expect === stepId) return turn; turn = stepWizard(turn.state, { answer }); }
    return turn;
  };
  const empty = stepWizard(at("intake").state, { answer: { serviceDesks: [], jql: "", mentionsOf: [] } });
  refusedOn(empty, "intake", "an intake with no source at all");
  ok(empty.stepId === "intake", "an empty intake does not advance the interview");
  const reason = empty.refused.find((r) => r.field === "intake").reason;
  ok(reason === VA_COPY.intakeEmpty, "the refusal is the copy home's sentence");
  ok(/queue/i.test(reason) && /JQL/i.test(reason) && /mention/i.test(reason), "the refusal names all three ways to give it work");
  const blank = stepWizard(at("intake").state, { answer: { serviceDesks: [], jql: "   ", mentionsOf: [] } });
  refusedOn(blank, "intake", "a whitespace-only JQL filter is not a source");
  const oneSource = stepWizard(at("intake").state, { answer: { serviceDesks: [], jql: "project = SUP", mentionsOf: [] } });
  ok(oneSource.refused.length === 0 && oneSource.stepId === "read_scope", "one source is enough to continue");
  const byMention = stepWizard(at("intake").state, { answer: { serviceDesks: [], jql: "", mentionsOf: ["557058:abc-123"] } });
  ok(byMention.refused.length === 0, "a mention list alone is enough");

  /*
   * F-953 - THE OTHER HALF OF THE SAME PROMISE. The gate counts DESKS, so a desk with no
   * queue passes it, and the review card says that means the whole desk. The engine sweeps
   * every queue of such a desk (virtual-admin.test.mjs section 2 proves that half); what is
   * asserted HERE is that the gate has not quietly started requiring a queue instead, which
   * would leave the card promising something no record can express.
   */
  const wholeDesk = stepWizard(at("intake").state, { answer: { serviceDesks: [{ serviceDeskId: "1", queueIds: [] }], jql: "", mentionsOf: [] } });
  ok(wholeDesk.refused.length === 0 && wholeDesk.stepId === "read_scope", `a desk with no queue is a source (got ${JSON.stringify(wholeDesk.refused)})`);
  ok(wholeDesk.state.answers.intake.serviceDesks[0].queueIds.length === 0, "and the record carries the empty queue list, which is what the engine reads as the whole desk");
  const card = renderReviewSummary(normalizeVa({ persona: { name: "Ada" }, intake: { serviceDesks: [{ serviceDeskId: "1", queueIds: [] }] } }, catalogToCtx(CATALOG)).va).join(" ");
  ok(/1 service desk/.test(card) && !/0 queue/.test(card), `the card claims the desk, never "0 queues" (got ${card})`);
}

/* ── 3. every refusal ──────────────────────────────────────────────────────── */

/* a helper that fast-forwards to a step with valid answers */
const at = (stepId) => {
  let turn = stepWizard(createWizard({ catalog: CATALOG }).state, null);
  for (const [id, answer] of HAPPY) {
    if (id === stepId) return turn;
    turn = stepWizard(turn.state, { answer });
  }
  return turn;
};

/* persona name — BLOCK an entirely illegal charset, ALLOW a clamped one (F-424) */
{
  const r = stepWizard(at("persona_name").state, { answer: "<<<###>>>" });
  refusedOn(r, "persona.name", "wizard.persona.BLOCK_illegal_charset");
  ok(r.stepId === "persona_name", "an illegal name does not advance the interview");

  const c = stepWizard(at("persona_name").state, { answer: "Nadia <script>" });
  ok(c.refused.length === 0 && c.stepId === "persona_voice", "wizard.persona.ALLOW_clamped_name — a partly-illegal name is clamped and accepted");
  ok(c.state.answers.personaName === "Nadia script", `the clamped name is stored (got ${JSON.stringify(c.state.answers.personaName)})`);
  ok(c.notes.some((n) => n.field === "persona.name"), "the clamp is REPORTED, never silent");

  const long = stepWizard(at("persona_name").state, { answer: "N".repeat(400) });
  ok(long.refused.length === 0 && long.state.answers.personaName.length === 40, "an over-long name is clamped to the shape bound");
}

/* voice */
{
  const bad = stepWizard(at("persona_voice").state, { answer: { register: "snarky" } });
  refusedOn(bad, "persona.voice.register", "an unknown register");
  const many = stepWizard(at("persona_voice").state, { answer: { maxSentences: 40 } });
  refusedOn(many, "persona.voice.maxSentences", "a sentence cap past the ceiling");
  const lang = stepWizard(at("persona_voice").state, { answer: { language: "klingon" } });
  refusedOn(lang, "persona.voice.language", "an unknown language");
  const chip = stepWizard(at("persona_voice").state, { answer: { chip: "spicier" } });
  refusedOn(chip, "persona.voice", "an unknown sample chip");
}

/* intake */
{
  const desk = stepWizard(at("intake").state, { answer: { serviceDesks: [{ serviceDeskId: "99", queueIds: [] }] } });
  refusedOn(desk, "intake.serviceDesks", "a service desk the site does not have");
  const queue = stepWizard(at("intake").state, { answer: { serviceDesks: [{ serviceDeskId: "1", queueIds: ["20"] }] } });
  refusedOn(queue, "intake.serviceDesks", "a queue that belongs to another desk");
  const mention = stepWizard(at("intake").state, { answer: { mentionsOf: ["not an account id!"] } });
  refusedOn(mention, "intake.mentionsOf", "a malformed account id");
}

/* the JQL SHAPE check — and the explicit statement that it proves nothing about running */
{
  ok(checkJqlShape("").ok && checkJqlShape(null).ok, "an empty JQL filter is an ordinary answer");
  ok(checkJqlShape('project = SUP AND summary ~ "vpn"').ok, "a well-formed filter passes the shape check");
  ok(!checkJqlShape('project = "SUP').ok, "wizard.jql.BLOCK_unclosed_quote");
  ok(!checkJqlShape("project = SUP AND (status = Open").ok, "wizard.jql.BLOCK_unclosed_bracket");
  ok(!checkJqlShape("project = SUP; DROP").ok, "wizard.jql.BLOCK_semicolon");
  ok(!checkJqlShape("project = SUP AND").ok, "wizard.jql.BLOCK_trailing_operator");
  ok(!checkJqlShape("x".repeat(3000)).ok, "wizard.jql.BLOCK_too_long");
  ok(!checkJqlShape("project = SUP \u0007").ok, "wizard.jql.BLOCK_control_characters");
  ok(!checkJqlShape(42).ok, "a non-string filter is refused");
  const r = stepWizard(at("intake").state, { answer: { jql: 'project = "SUP' } });
  refusedOn(r, "intake.jql", "a malformed JQL filter");
  // F-424's dry search is the RESOLVER's (5b). This module must not claim it.
  const src = "the executable proof is 5b's";
  ok(typeof src === "string", `note: shape-only here — ${src}`);
}

/* read scope */
{
  const unknown = stepWizard(at("read_scope").state, { answer: { projects: ["NOPE"] } });
  refusedOn(unknown, "scope.read.projects", "a project the catalogue does not carry");
  ok(unknown.refused[0].reason.includes("NOPE"), "the refusal NAMES the project");
  const bad = stepWizard(at("read_scope").state, { answer: { projects: ["lower case"] } });
  refusedOn(bad, "scope.read.projects", "a string that is not a project key");
  const none = stepWizard(at("read_scope").state, { answer: { projects: [] } });
  refusedOn(none, "scope.read.projects", "an empty read scope");
  const site = stepWizard(at("read_scope").state, { answer: { site: true } });
  ok(site.refused.length === 0 && site.state.answers.readScope.site === true, "read MAY be site-wide");
}

/* write scope — the one that must never widen (F-410) */
{
  const site = stepWizard(at("write_scope").state, { answer: { site: true } });
  refusedOn(site, "scope.write.site", "wizard.write.BLOCK_site_wide");
  ok(site.refused[0].reason === writeSiteRefusalReason(), "the wizard refuses site-wide writes in normalizeVa's own words");
  ok(/project/i.test(site.refused[0].reason), "the site-wide refusal explains why");
  ok(site.stepId === "write_scope", "a site-wide write does not advance the interview");

  const outside = stepWizard(at("write_scope").state, { answer: { projects: ["SEC"] } });
  refusedOn(outside, "scope.write.projects", "a write project outside the read scope");
  ok(outside.refused[0].reason.includes("cannot write where it cannot read"), "the read/write refusal explains the rule");

  const unknown = stepWizard(at("write_scope").state, { answer: { projects: ["GHOST"] } });
  refusedOn(unknown, "scope.write.projects", "a write project the catalogue does not carry");

  const none = stepWizard(at("write_scope").state, { answer: { projects: [] } });
  ok(none.refused.length === 0, "an empty write scope is a valid answer (read-only agent)");
}

/* cadence */
{
  const preset = stepWizard(at("cadence").state, { answer: { preset: "every7seconds" } });
  refusedOn(preset, "cadence.preset", "a cadence the app does not offer");
  const zone = stepWizard(at("cadence").state, { answer: { preset: "hourly", timeZone: "Mars/Olympus" } });
  refusedOn(zone, "cadence.timeZone", "a time zone this site does not offer");
  const cron = stepWizard(at("cadence").state, { answer: { preset: "custom" } });
  refusedOn(cron, "cadence.cron", "a custom cadence with no cron");
  const day = stepWizard(at("cadence").state, { answer: { preset: "hourly", postWindow: { days: [9] } } });
  refusedOn(day, "cadence.postWindow.days", "a posting day outside 0-6");
  const time = stepWizard(at("cadence").state, { answer: { preset: "hourly", postWindow: { days: [1], from: "25:00" } } });
  refusedOn(time, "cadence.postWindow.from", "a posting time that is not HH:MM");
}

/* powers */
{
  const config = stepWizard(at("powers").state, { answer: { editWorkflows: true } });
  refusedOn(config, "powers.editWorkflows", "a power that does not exist");
  ok(config.refused[0].reason.includes("propose"), "the unknown-power refusal says configuration can only be proposed");
  const notBool = stepWizard(at("powers").state, { answer: { assign: "yes" } });
  refusedOn(notBool, "powers.assign", "a power that is not a boolean");
  const skill = stepWizard(at("powers").state, { answer: { skillIds: ["skill_that_is_gone"] } });
  refusedOn(skill, "powers.skillIds", "a skill that does not exist");
}

/* guardrails — including the two DROPPED fields (F-412 / F-425) */
{
  const high = stepWizard(at("guardrails").state, { answer: { capsPerHour: 100000 } });
  refusedOn(high, "guardrails.capsPerHour", "a cap past its ceiling");
  const nan = stepWizard(at("guardrails").state, { answer: { capsPerDay: "lots" } });
  refusedOn(nan, "guardrails.capsPerDay", "a cap that is not a number");
  const owed = stepWizard(at("guardrails").state, { answer: { owedUncapped: true } });
  refusedOn(owed, "guardrails.owedUncapped", "the dropped owedUncapped field");
  const bulk = stepWizard(at("guardrails").state, { answer: { maxBulkTargets: 50 } });
  refusedOn(bulk, "guardrails.maxBulkTargets", "the dropped maxBulkTargets field (F-425)");
  const inbox = stepWizard(at("guardrails").state, { answer: { approvalProjectKey: "GHOST" } });
  refusedOn(inbox, "guardrails.approvalProjectKey", "an approval inbox the catalogue does not carry");
  const gap = stepWizard(at("guardrails").state, { answer: { minPostGapMinutes: 0 } });
  refusedOn(gap, "guardrails.minPostGapMinutes", "a post gap below its FLOOR");
}

/* review */
{
  const back = stepWizard(at("review").state, { answer: { back: "powers" } });
  ok(back.refused.length === 0 && back.stepId === "powers", "review can send the admin back to a named step");
  const nowhere = stepWizard(at("review").state, { answer: { back: "hack" } });
  refusedOn(nowhere, "review", "a step that does not exist");
  const forward = stepWizard(at("review").state, { answer: { back: "create" } });
  refusedOn(forward, "review", "going 'back' to a later step");
  const noConfirm = stepWizard(at("review").state, { answer: {} });
  refusedOn(noConfirm, "review", "an unconfirmed review");
}

/* ── 4. the model cannot steer ──────────────────────────────────────────────── */

{
  const start = at("persona_name").state;

  /* a `field` the machine does not know */
  const bogus = stepWizard(start, { model: { say: "Let us set the guardrails.", field: "guardrails", done: false } });
  refusedOn(bogus, "field", "wizard.model.BLOCK_bogus_field");
  ok(bogus.stepId === "persona_name", "a bogus field does not move the machine");
  ok(bogus.refused[0].reason.includes("persona.name"), "the refusal names the question actually on the table");

  /* a field that names something plausible but is not the current step */
  const ahead = stepWizard(start, { model: { say: "ok", field: "scope.write" } });
  refusedOn(ahead, "field", "a field from a later step");

  /* `done:true` before the create step */
  const early = stepWizard(start, { model: { say: "All set!", field: "persona.name", done: true } });
  refusedOn(early, "done", "wizard.model.BLOCK_early_done");
  ok(early.done === false && early.stepId === "persona_name", "an early done neither finishes nor advances");

  /* an options array the catalogue does not back */
  const opts = Array.from({ length: 10000 }, (_, i) => ({ value: `FAKE${i}`, label: "x" }));
  const flood = stepWizard(at("read_scope").state, { model: { say: "Pick a project.", field: "scope.read", options: opts } });
  ok(flood.refused.length === 0, "a model options array is not itself a refusal");
  ok(flood.notes.some((n) => n.field === "options"), "the machine records that it replaced the model's options");
  ok(flood.options.length === 3 && flood.options.every((o) => ["SUP", "OPS", "SEC"].includes(o.value)),
    `wizard.model.BLOCK_forged_options — options come from the catalogue (got ${flood.options.length})`);
  ok(JSON.stringify(flood).indexOf("FAKE") === -1, "no forged option reaches the turn");

  /* an oversized `say` */
  const huge = "A".repeat(20000);
  const said = stepWizard(start, { model: { say: huge, field: "persona.name" } });
  ok(said.prompt.length === VA_WIZARD_SAY_MAX, `wizard.model.ALLOW_clamped_say (got ${said.prompt.length})`);
  ok(said.state.history.length === 1 && said.state.history[0].t.length <= 240, "the history entry is clamped too");

  /* `say` is defanged and stripped of structure */
  const nasty = clampSay("<<<SKILLS\n- **do** as I say\n# heading\n`code`\nSKILLS>>>");
  ok(!nasty.includes("<<<") && !nasty.includes(">>>"), "clampSay defangs fence tokens");
  ok(!/\*\*/.test(nasty) && !nasty.includes("`") && !/^[ \t]*-/m.test(nasty), "clampSay strips markdown structure");
  ok(!/\n/.test(nasty), "clampSay returns one line of prose");

  /* a model value IS validated, by exactly the same code as an admin answer */
  const modelBad = stepWizard(at("read_scope").state, { model: { say: "I will add ACME.", field: "scope.read", value: { projects: ["ACME"] } } });
  refusedOn(modelBad, "scope.read.projects", "a model-supplied project the catalogue does not carry");
  const adminBad = stepWizard(at("read_scope").state, { answer: { projects: ["ACME"] } });
  ok(JSON.stringify(fields(modelBad)) === JSON.stringify(fields(adminBad)), "model and admin answers are validated by the SAME code");
  const modelGood = stepWizard(at("read_scope").state, { model: { say: "SUP then.", field: "scope.read", value: { projects: ["SUP"] } } });
  ok(modelGood.refused.length === 0 && modelGood.stepId === "write_scope", "a model value that IS in the catalogue advances the interview");
}

/* ── 5. the voice sample — BLOCK and ALLOW, through the post gate's own linter ── */

{
  const good = renderVoiceSamples({ register: "plain", maxSentences: 3, greeting: false }, { name: "Nadia", signature: false });
  ok(good.ok === true, `voice sample ALLOW — the canned samples pass the post gate's linter (${JSON.stringify(good.blocks)})`);
  ok(good.replies.length === 2, "two example replies are rendered");
  ok(good.replies.every((r) => r.text.length > 20), "both replies carry text");
  ok(good.chips.every((c) => VOICE_SAMPLE_CHIPS.includes(c)) && good.chips.includes("keep"), `the chips are the published set (got ${good.chips})`);
  ok(good.chips.includes("shorter") && good.chips.includes("warmer"), "Shorter and Warmer are offered when they can be applied");

  const terse = renderVoiceSamples({ register: "terse", maxSentences: 2 }, { name: "Nadia" });
  ok(terse.ok === true, `terse samples pass (${JSON.stringify(terse.blocks)})`);
  ok(!terse.chips.includes("terser"), "Terser is not offered at the terse register");
  ok(terse.replies.every((r) => r.text.split(/(?<=[.!?])\s+/).length <= 2), "the sample honours the sentence cap");

  const warm = renderVoiceSamples({ register: "warm", maxSentences: 3 }, { name: "Nadia" });
  ok(warm.ok === true, `warm samples pass (${JSON.stringify(warm.blocks)})`);
  ok(!warm.chips.includes("warmer"), "Warmer is not offered at the warm register");

  const greet = renderVoiceSamples({ register: "plain", maxSentences: 3, greeting: true }, { name: "Nadia" });
  ok(greet.ok === true, `a greeting does not break the sample (${JSON.stringify(greet.blocks)})`);
  ok(greet.replies[0].text.startsWith("Hi there,"), "the greeting is folded into the first sentence, not added as one");

  const signed = renderVoiceSamples({ register: "plain", maxSentences: 3 }, { name: "Nadia", signature: true });
  ok(signed.ok === true, `a signature fits inside a three-sentence budget (${JSON.stringify(signed.blocks)})`);
  ok(signed.replies[0].text.endsWith("\nNadia"), "the signature is the persona name on its own line");

  // BLOCK: one sentence AND a signature do not fit, and the sample says so honestly
  // rather than dropping the signature behind the admin's back.
  const cramped = renderVoiceSamples({ register: "plain", maxSentences: 1 }, { name: "Nadia", signature: true });
  ok(cramped.ok === false && cramped.blocks.some((b) => b.rule === "over_max_sentences"),
    `voice sample BLOCK — one sentence plus a signature is reported (${JSON.stringify(cramped.blocks)})`);
  ok(!cramped.chips.includes("shorter"), "Shorter is not offered at the floor");

  // The sample reaches the admin through the turn, and it fails OPEN by contract.
  const turn = at("persona_voice");
  ok(turn.sample && turn.sample.ok === true && turn.sample.replies.length === 2, "the voice step carries the sample on the turn");
  ok(Array.isArray(turn.sample.blocks), "the sample returns {ok, blocks} for the UI chips");

  // A chip adjusts the voice and stays on the step; "keep" accepts and advances.
  const shorter = stepWizard(turn.state, { answer: { chip: "shorter" } });
  ok(shorter.stepId === "persona_voice" && shorter.state.answers.voice.maxSentences === VA_DEFAULTS.persona.voice.maxSentences - 1,
    "the Shorter chip lowers the sentence cap and re-renders on the same step");
  const warmer = stepWizard(turn.state, { answer: { chip: "warmer" } });
  ok(warmer.state.answers.voice.register === "warm", "the Warmer chip raises the register");
  const keep = stepWizard(turn.state, { answer: { chip: "keep" } });
  ok(keep.stepId === "intake", "the Keep chip accepts the voice and advances");
}

/* ── 6. ONE RECORD, TWO DOORS — the machine and the classic form agree ───────── */

{
  // The classic form's record for exactly the same answers, written by hand the way
  // VaEditor.jsx will assemble it.
  const classic = {
    persona: {
      name: "Nadia",
      voice: { register: "plain", greeting: false, maxSentences: 3, language: "en" },
      signature: true,
    },
    scope: { read: { site: false, projects: ["SUP", "OPS"] }, write: { projects: ["SUP"] } },
    intake: {
      serviceDesks: [{ serviceDeskId: "1", queueIds: ["10", "11"] }],
      jql: 'project = SUP AND status = "Waiting for support"',
      mentionsOf: ["557058:abc-123"],
      owedFirst: true,
    },
    cadence: { preset: "every30", timeZone: "Europe/Berlin", postWindow: { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" } },
    powers: { replyInternal: true, replyPublic: true, transition: true, skillIds: ["skill_jsm_tone"] },
    guardrails: { capsPerHour: 4, capsPerDay: 20, minPostGapMinutes: 10, maxItemsPerTick: 3, maxWritesPerRun: 5, approvalProjectKey: "OPS" },
    status: { paused: false, shadowUntilTick: VA_DEFAULTS.guardrails.shadowTicks },
  };
  const direct = normalizeVa(classic, catalogToCtx(CATALOG));
  ok(JSON.stringify(happy.turn.va) === JSON.stringify(direct.va),
    "wizard.record.IDENTICAL — the wizard and the classic form produce byte-identical records");
  ok(JSON.stringify(direct.refused) === JSON.stringify(happy.turn.refused), "and they refuse identically");

  // The wizard's OWN intermediate record goes through normalizeVa untouched, which is
  // what proves it grew no clamp of its own.
  const wizardRecord = buildVaRecord(happy.turn.state);
  const twice = normalizeVa(normalizeVa(wizardRecord, catalogToCtx(CATALOG)).va, catalogToCtx(CATALOG));
  ok(JSON.stringify(twice.va) === JSON.stringify(happy.turn.va), "normalizeVa is stable over the wizard's record");
  ok(twice.refused.length === 0, "a wizard record re-normalises with no refusals");
}

/* ── 7. create fails CLOSED into the classic form ───────────────────────────── */

{
  // A state whose answers cannot become a record (no name — only reachable by a caller
  // that hand-built the state, which the resolver can do on resume).
  const broken = { v: VA_WIZARD_VERSION, stepId: "create", answers: { readScope: { site: false, projects: ["SUP"] } }, history: [], refused: [], notes: [], done: false, catalog: CATALOG };
  const r = stepWizard(broken, { answer: { confirm: true } });
  ok(r.done === false, "a record normalizeVa refuses is not created");
  ok(r.fallbackToForm === true, "the wizard falls back to the classic form");
  refusedOn(r, "record", "a record the save path refuses");
  ok(r.record && r.record.scope.read.projects.join(",") === "SUP", "the partial record travels with the fallback");
}

/* ── 8. the state is storable ───────────────────────────────────────────────── */

{
  const { state, bytes, truncated } = serializeWizardState(happy.turn.state);
  ok(bytes <= VA_WIZARD_STATE_MAX_BYTES, `the stored state fits the 8 KB budget (${bytes} bytes)`);
  ok(truncated === false, "a normal interview is not truncated");
  ok(state.catalog === undefined, "the live catalogue is NOT persisted");
  ok(JSON.stringify(state) === JSON.stringify(JSON.parse(JSON.stringify(state))), "the stored state is JSON-serialisable");
  ok(state.stepId === "create" && state.done === true && state.v === VA_WIZARD_VERSION, "the stored state carries the step, the version and the finish flag");
  ok(state.answers.personaName === "Nadia", "the answers are what survive");

  // A very long transcript is trimmed from the OLDEST end, and the answers still survive.
  const fat = { ...happy.turn.state, history: Array.from({ length: 200 }, (_, i) => ({ r: "a", t: `line ${i} ${"x".repeat(200)}` })) };
  const s2 = serializeWizardState(fat);
  ok(s2.bytes <= VA_WIZARD_STATE_MAX_BYTES, `an oversized transcript is trimmed to budget (${s2.bytes} bytes)`);
  ok(s2.truncated === true, "the trim is reported");
  ok(s2.state.answers.personaName === "Nadia", "trimming costs the transcript, never an answer");
  ok(s2.state.history.length < 200, "the transcript is what gets shorter");

  // A catalogue far bigger than the budget never lands in the stored value.
  const big = { projects: Array.from({ length: 400 }, (_, i) => ({ key: `P${i}`, name: `Project number ${i}` })) };
  const s3 = serializeWizardState({ ...happy.turn.state, catalog: big });
  ok(s3.bytes <= VA_WIZARD_STATE_MAX_BYTES && JSON.stringify(s3.state).indexOf("Project number") === -1, "a huge catalogue never reaches KVS");

  // Resume re-attaches this turn's catalogue and drops a state from another version.
  const resumed = resumeWizard(state, CATALOG);
  ok(resumed.stepId === "create" && resumed.catalog === CATALOG, "resume restores the step and re-attaches the live catalogue");
  ok(resumeWizard({ ...state, v: 99 }, CATALOG).stepId === "persona_name", "a state from another version restarts the interview");
  ok(resumeWizard({ ...state, stepId: "invented_step" }, CATALOG).stepId === "persona_name", "a state on an unknown step restarts the interview");
  ok(resumeWizard(null, CATALOG).stepId === "persona_name", "a missing state starts a fresh interview");
}

/* ── 8b. F-953 the stored draft can be DESCRIBED, so it can be offered back ── */

{
  /*
   * The wizard resumed `va_wizard:{accountId}` SILENTLY, so "Create your first one" put a
   * reviewer on the review card of an agent they had never configured. The resume is a
   * question now, and this is the data the question is asked from.
   */
  const fresh = createWizard({ catalog: CATALOG, now: 1_757_000_000_000 }).state;
  ok(fresh.startedAt === 1_757_000_000_000, "a fresh interview records when it was started");
  const freshInfo = wizardResumeInfo(fresh);
  ok(freshInfo.resumable === false, "an interview that has answered nothing is not a draft worth offering");
  ok(freshInfo.total === WIZARD_QUESTION_COUNT && freshInfo.total === 9, `the promise on the empty tab is nine questions (got ${freshInfo.total})`);

  const named = stepWizard(fresh, { answer: "Nadia" });
  const one = wizardResumeInfo(named.state);
  ok(one.resumable === true && one.answered === 1 && one.name === "Nadia", `one answer is a resumable draft (got ${JSON.stringify(one)})`);
  ok(one.startedAt === 1_757_000_000_000, "the start time survives a turn");

  const atReview = wizardResumeInfo(happy.turns[8].state);
  ok(atReview.stepId === "review" && atReview.answered === 8, `the eight answered steps are counted (got ${JSON.stringify(atReview)})`);
  const finished = wizardResumeInfo(happy.turn.state);
  ok(finished.answered === 9, `a confirmed review is the ninth answer (got ${finished.answered})`);

  /* THROUGH KVS AND BACK: the card has to be able to date a draft a week later. */
  const stored = serializeWizardState(happy.turns[8].state).state;
  ok(stored.startedAt === happy.turns[8].state.startedAt, "the start time is persisted");
  const back = wizardResumeInfo(resumeWizard(stored, CATALOG));
  ok(back.answered === 8 && back.name === "Nadia" && back.startedAt === stored.startedAt, "a resumed draft describes itself the same way");

  /* A state from an older build carries no start time; it is still resumable, undated. */
  const legacy = { ...stored }; delete legacy.startedAt;
  const li = wizardResumeInfo(resumeWizard(legacy, CATALOG));
  ok(li.resumable === true && li.answered === 8, "a draft stored before this field existed is still offered");
  ok(wizardResumeInfo(null).resumable === false, "no state is not a draft");
  /* Going BACK does not un-answer anything: the count is the answers, not the step index. */
  const wentBack = stepWizard(happy.turns[8].state, { answer: { back: "persona_voice" } });
  ok(wizardResumeInfo(wentBack.state).answered === 8, "a draft that went back to an earlier step still counts its answers");
}

/* ── 9. options and the catalogue translation ───────────────────────────────── */

{
  const st = { catalog: CATALOG };
  ok(optionsForStep("read_scope", st).map((o) => o.value).join(",") === "SUP,OPS,SEC", "project options come from the catalogue");
  ok(optionsForStep("cadence", st).some((o) => o.value === "every30"), "cadence options come from SCHEDULE_PRESETS");
  ok(optionsForStep("powers", st).length === 9, `power options are the closed allow-list (got ${optionsForStep("powers", st).length})`);
  ok(optionsForStep("intake", st)[0].queues.map((q) => q.value).join(",") === "10,11", "queue options hang off their desk");
  ok(optionsForStep("persona_name", st).length === 0, "a free-text step offers no options");
  ok(optionsForStep("read_scope", { catalog: { projects: Array.from({ length: 5000 }, (_, i) => ({ key: `PR${i}` })) } }).length === 200,
    "the option list is capped so one turn cannot become a megabyte");

  const ctx = catalogToCtx(CATALOG);
  ok(ctx.projects.join(",") === "SUP,OPS,SEC", "catalogToCtx hands normalizeVa the project keys");
  ok(ctx.serviceDesks[0].queueIds.join(",") === "10,11", "catalogToCtx translates queues[] into queueIds[]");
  ok(ctx.skillIndex.join(",") === "skill_jsm_tone,skill_triage", "catalogToCtx flattens the skill index");
  ok(Object.keys(catalogToCtx(null)).length === 0, "an absent catalogue yields an empty context (shape checks only)");

  // With NO catalogue the machine cannot check against live data, so it must not pretend
  // to: a project key of the right SHAPE is accepted and the resolver is on the hook.
  const noCat = stepWizard(createWizard({ catalog: {} }).state, { answer: "Nadia" });
  const readNoCat = stepWizard(stepWizard(noCat.state, { answer: { register: "plain" } }).state, { answer: { jql: "project = X" } });
  ok(readNoCat.stepId === "read_scope", "the interview runs without a catalogue");
}

/* ── 10. the summary renderer stands alone ──────────────────────────────────── */

{
  const { va } = normalizeVa({ persona: { name: "Quiet" }, scope: { read: { projects: ["SUP"] }, write: { projects: [] } } }, catalogToCtx(CATALOG));
  const s = renderReviewSummary(va);
  ok(s.some((x) => x.includes("It changes nothing")), "a read-only agent is described as one");
  ok(s.some((x) => x.includes("no intake source")), "an agent with no intake is told so");
  // F-916 — the power is named in the POWERS STEP's own words, never by its record id.
  ok(s.some((x) => x.includes(vaPowerPhrase("replyInternal"))), `the default power is named in words (got ${JSON.stringify(s)})`);
  ok(!s.join(" ").includes("replyInternal"), "no power id leaks into the review card");
  const bare = normalizeVa({ persona: { name: "Mute" }, powers: { replyInternal: false } }, catalogToCtx(CATALOG)).va;
  ok(renderReviewSummary(bare).some((x) => x.includes("no powers")), "an agent with no powers is told so");

  /* F-928 - THE CARD COUNTED DESKS AND CALLED THEM SOURCES. Three queues of one desk
     reviewed as "1 service desk source", so the number the admin had just picked was
     nowhere on the last screen before the agent starts working. The queues are what the
     sweep reads, so the card counts them. */
  const intakeOf = (serviceDesks) => renderReviewSummary(normalizeVa(
    { persona: { name: "Nadia" }, intake: { serviceDesks } }, catalogToCtx(CATALOG)).va).join(" ");
  const many = intakeOf([{ serviceDeskId: "1", queueIds: ["10", "11"] }, { serviceDeskId: "2", queueIds: ["20"] }]);
  ok(/2 service desks and 3 queues/.test(many), `two desks and three queues are counted as both (got ${many})`);
  const one = intakeOf([{ serviceDeskId: "2", queueIds: ["20"] }]);
  ok(/1 service desk and 1 queue\b/.test(one), `the singular forms are used for one of each (got ${one})`);
  const threeOfOne = intakeOf([{ serviceDeskId: "1", queueIds: ["10", "11"] }]);
  ok(/1 service desk and 2 queues/.test(threeOfOne), `one desk with two queues names the queues (got ${threeOfOne})`);
  ok(!/service desk source/.test(`${many} ${one} ${threeOfOne}`), "the word source is gone from the desk phrase");
  // A desk with no queue named is the WHOLE desk, so there is no queue number to give.
  const whole = intakeOf([{ serviceDeskId: "1", queueIds: [] }, { serviceDeskId: "2", queueIds: [] }]);
  ok(/2 service desks\./.test(whole) && !/queue/.test(whole), `desks with no queues read as desks alone (got ${whole})`);
}

console.log(`\nva-wizard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
