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
 * THE SETUP INTERVIEW AS A PURE STATE MACHINE (release 1.5, commit 5a).
 *
 * The Agents tab offers two ways to build a Virtual Administrator: a chat wizard and the
 * classic form. This module is the wizard's BRAIN, and it is the only half of it that
 * decides anything. The UI renders; the resolver fetches live data and persists; NEITHER
 * of them validates. That split exists because the wizard's other participant is a MODEL,
 * and a model that can choose a code path by returning a string is not a wizard, it is a
 * remote-execution surface with a chat bubble in front of it.
 *
 * WHAT THE MODEL MAY AND MAY NOT DO. The model returns strict JSON
 * `{say, ask, field, options?, done}`. Of that:
 *   - `say`   is PROSE. It is defanged, markdown-stripped, whitespace-collapsed and
 *             clamped, and it comes back out as `prompt` for the UI to render as text.
 *   - `ask`   is IGNORED in favour of the code-authored question for the current step.
 *   - `field` must NAME THE CURRENT STEP. It never selects a code path; it is checked
 *             against one step id and refused otherwise. A `field` the machine does not
 *             know is a refusal with a named reason, not a branch.
 *   - `options` are IGNORED, always, in favour of options derived from `state.catalog`.
 *             An option the catalogue does not carry cannot be offered, so it cannot be
 *             picked, so a hallucinated project key never reaches a record.
 *   - `done`  is IGNORED unless the machine is already standing on the create step. A
 *             model cannot finish an interview early.
 *   - `value` (optional) is validated by EXACTLY the same code as an admin's answer.
 * The caller decides whether an input is an admin answer or model JSON; this machine
 * validates both through one function, which is what the test asserts.
 *
 * THE FIELD ORDER IS IN CODE, not in the prompt (F-424 class). name -> voice -> intake ->
 * read scope -> write scope -> cadence and post window -> powers -> guardrails -> review
 * -> create. A model cannot reorder it, skip a step or invent one.
 *
 * ONE RECORD, TWO DOORS (F-420 class). The wizard does not have its own save path and does
 * not have its own clamps: it assembles the SAME `va` block the classic form assembles and
 * hands it to `normalizeVa` with the SAME catalogue-derived context. The test drives the
 * same answers through the machine and through a direct `normalizeVa` call and asserts the
 * two records are byte-identical. If this module ever grows a clamp of its own, that test
 * is what tells you the two doors have started to disagree.
 *
 * IT PERSISTS NOTHING. `state` is a plain JSON value; the resolver stores it at
 * `va_wizard:{accountId}` (commit 5b) so a closed tab resumes. `serializeWizardState`
 * strips the live catalogue (which is fetched fresh on every turn and is far larger than
 * the budget) and clamps `history` until the state fits `VA_WIZARD_STATE_MAX_BYTES`.
 *
 * WHAT IT CANNOT DO, BY CONSTRUCTION. It does no I/O, so it cannot prove a JQL runs. The
 * `jql` answer gets a SHAPE check here and nothing more; the dry `search` bounded to one
 * result is F-424's, it lives in the resolver (commit 5b), and a JQL that passes the shape
 * check here is NOT yet standing intake. Do not read this module's acceptance as proof.
 *
 * FAIL CONTRACT (LAW 3). The wizard fails CLOSED into the classic form. A step that cannot
 * validate does not advance and returns `refused[]` with a sentence per field; a `create`
 * that `normalizeVa` refuses returns `fallbackToForm: true` with the partial record intact,
 * so the admin lands in `VaEditor.jsx` holding everything they already answered. Nothing is
 * ever accepted "because the model said so", and nothing is silently widened. The one
 * deliberate fail-OPEN is the voice sample preview: nothing is sent from the wizard, so a
 * lint fault there renders the sample labelled unchecked rather than blocking setup.
 *
 * Dependency-free like every `src/shared/*` module: it bundles into the Forge backend AND
 * the admin-panel webpack build, which is the only reason the wizard's review card and the
 * engine's gates can be guaranteed to quote the same numbers.
 */

import {
  normalizeVa, renderGuardrailSentences, clampPersonaName,
  VA_DEFAULTS, VA_POWERS, VA_REGISTERS, VA_LANGUAGES, VA_CEILINGS, VA_LIMITS,
  VA_MAX_SENTENCES_MIN, VA_MAX_SENTENCES_MAX,
  VA_JQL_MAX, VA_MENTIONS_MAX, VA_PROJECTS_MAX, VA_SERVICE_DESKS_MAX,
  VA_QUEUES_PER_DESK_MAX, VA_PROJECT_KEY_RE, VA_PERSONA_NAME_MAX,
} from "./va-config.js";
import { lintVoice } from "./voice-lint.js";
import { SCHEDULE_PRESETS } from "./cron.js";
import { clampChars } from "./text-clamp.js";
import { defangFence } from "./prompt-fencing.js";

/* -- Budgets that belong to the INTERVIEW (not to the record) ------------------ */

/** The state version. A resumed state with another version is discarded, not migrated. */
export const VA_WIZARD_VERSION = 1;
/** The KVS budget for one stored interview. `serializeWizardState` enforces it. */
export const VA_WIZARD_STATE_MAX_BYTES = 8192;
/** Model prose, per turn. Long enough for three sentences, short enough to be a bubble. */
export const VA_WIZARD_SAY_MAX = 600;
/** One remembered line of the conversation, and how many are kept. */
export const VA_WIZARD_HISTORY_TEXT_MAX = 240;
export const VA_WIZARD_HISTORY_MAX = 12;
/**
 * The option-list ceiling. It bounds what the UI renders AND what a turn can carry back,
 * so a site with 3,000 projects cannot make a wizard turn into a multi-megabyte answer.
 * When the catalogue is longer than this the admin types the key instead, and the typed key
 * is still checked against the FULL catalogue: the cap trims the picker, never the check.
 */
export const VA_WIZARD_OPTIONS_MAX = 200;

/* -- The steps. The order is here and nowhere else. ---------------------------- */

/**
 * `id` is what the caller and the model must name; `field` is the record path the step
 * fills. Both are matched EXACTLY, and a `field` that is neither is refused by name.
 */
export const WIZARD_STEPS = Object.freeze([
  Object.freeze({ id: "persona_name", field: "persona.name", ask: "What should this agent be called? The name is printed in every message it writes, so keep it short and plain." }),
  Object.freeze({ id: "persona_voice", field: "persona.voice", ask: "How should it sound? Pick a register and how many sentences a reply may run to. The sample is checked by the same rules that check the real messages." }),
  Object.freeze({ id: "intake", field: "intake", ask: "Where should it look for work? You can name service desk queues, a JQL filter, and people whose mentions it should pick up." }),
  Object.freeze({ id: "read_scope", field: "scope.read", ask: "Which projects may it read?" }),
  Object.freeze({ id: "write_scope", field: "scope.write", ask: "Which of those projects may it change? Leave this empty and it will read, stage replies and propose changes without touching anything." }),
  Object.freeze({ id: "cadence", field: "cadence", ask: "How often should it run, in which time zone, and between which hours may it post?" }),
  Object.freeze({ id: "powers", field: "powers", ask: "What is it allowed to do? Everything here is off unless you turn it on, and configuration changes are not on the list at all." }),
  Object.freeze({ id: "guardrails", field: "guardrails", ask: "Now the brakes. These are the numbers the engine enforces, so what you set here is what happens." }),
  Object.freeze({ id: "review", field: "review", ask: "This is what the agent will be. Read it, then confirm or go back to any step." }),
  Object.freeze({ id: "create", field: "create", ask: "Ready to create it?" }),
]);

const STEP_IDS = Object.freeze(WIZARD_STEPS.map((s) => s.id));
const stepAt = (id) => WIZARD_STEPS.find((s) => s.id === id) || null;
const stepIndex = (id) => STEP_IDS.indexOf(id);

/** The chips the voice sample offers. The UI renders them; this module applies them. */
export const VOICE_SAMPLE_CHIPS = Object.freeze(["keep", "shorter", "warmer", "terser"]);

/* -- Small pure helpers -------------------------------------------------------- */

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => JSON.parse(JSON.stringify(v));
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Model prose turned into renderable text. Defanged FIRST (so it can never carry a fence
 * token into the next turn's prompt or into KVS), then markdown markers stripped, then
 * whitespace collapsed, then clamped by CODE POINTS. The result is prose or it is empty;
 * it is never structure, and it is never long enough to push the state over its budget.
 */
export const clampSay = (value) => {
  const raw = typeof value === "string" ? value : "";
  const flattened = defangFence(raw)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/`/g, "")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*(?:[-*+•‣]|\d+[.)])[ \t]+/gm, "")
    .replace(/(\*\*|__|\*|_)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clampChars(flattened, VA_WIZARD_SAY_MAX);
};

/**
 * The catalogue, translated into the `ctx` `normalizeVa` expects. ONE translation, used by
 * the machine AND by the resolver, because a wizard that validated against `queues[]` while
 * the save path validated against `queueIds[]` would accept a queue the save path drops.
 *
 * @param {object} catalog `{projects:[{key}|string], serviceDesks:[{id, queues:[{id, jql}]}],
 *                           timeZones:[string], skillIndex:[{id}|string]}`
 */
export const catalogToCtx = (catalog) => {
  const c = isObj(catalog) ? catalog : {};
  const ctx = {};
  if (Array.isArray(c.projects)) ctx.projects = c.projects.map((p) => String(isObj(p) ? p.key : p).toUpperCase());
  if (Array.isArray(c.serviceDesks)) {
    ctx.serviceDesks = c.serviceDesks.map((d) => ({
      id: String(isObj(d) ? (d.id != null ? d.id : d.serviceDeskId) : d),
      queueIds: asArray(isObj(d) ? d.queues : null).map((q) => String(isObj(q) ? q.id : q)),
    }));
  }
  if (Array.isArray(c.timeZones) && c.timeZones.length) ctx.timeZones = c.timeZones.map(String);
  if (Array.isArray(c.skillIndex)) ctx.skillIndex = c.skillIndex.map((s) => String(isObj(s) ? s.id : s));
  return ctx;
};

/**
 * The site-wide-write refusal sentence, taken FROM `normalizeVa` rather than retyped.
 * The wizard must refuse the same thing in the same words as the save path, and probing the
 * one authority is how that stays true when the sentence is edited (F-410 / F-420 class).
 */
export const writeSiteRefusalReason = () => {
  try {
    normalizeVa({ persona: { name: "Probe" }, scope: { write: { site: true } } }, {});
  } catch (e) {
    return String(e && e.message ? e.message : "");
  }
  // Only reachable if normalizeVa stops refusing site-wide writes, which va-config.test.mjs
  // forbids. The wizard still refuses, with its own words, rather than falling through.
  return "A Virtual Administrator writes only inside a named list of projects.";
};

/* -- The voice sample (F-420: the wizard sample runs the POST GATE's own code) -- */

/**
 * Two example replies, per register. They are OURS, and no model writes them, because the
 * sample's job is to show the SHAPE the rules produce; a model-written sample would show
 * the shape the model happened to pick that turn.
 *
 * The first sentence of each is deliberately short: the burstiness rule blocks three
 * sentences with no short one, and a canned sample that trips our own linter would teach an
 * admin that the rules are noise.
 */
const SAMPLE_POOLS = Object.freeze({
  terse: Object.freeze([
    Object.freeze(["Picked this up.", "The licence request is waiting on finance approval from last Tuesday.", "I will check again tomorrow."]),
    Object.freeze(["Not yet, sorry.", "The laptop is ordered and the supplier gave us Thursday.", "I will confirm once it lands."]),
  ]),
  plain: Object.freeze([
    Object.freeze(["Picked this up.", "The licence request has been waiting on finance approval since last Tuesday, so nothing has moved on our side.", "I will chase it tomorrow and update here."]),
    Object.freeze(["Not yet, sorry.", "The laptop is ordered and the supplier has given us Thursday as the delivery date.", "I will confirm here once it arrives."]),
  ]),
  warm: Object.freeze([
    Object.freeze(["Picked this up.", "I know this has dragged on, and the licence request is still sitting with finance from last Tuesday.", "I will chase it tomorrow and tell you what they say."]),
    Object.freeze(["Not yet, sorry.", "The laptop is ordered and the supplier has given us Thursday, which I know is later than you hoped.", "I will confirm here the moment it arrives."]),
  ]),
});

const SAMPLE_KINDS = Object.freeze(["internal", "public"]);

/**
 * Render the two sample replies for a voice block and lint them with `lintVoice`: the SAME
 * function post gate 9 calls, with the SAME tables. That is the whole point of the step.
 *
 * A signature costs a sentence out of the budget. At `maxSentences: 1` there is no budget
 * left for it, so the sample renders both anyway and reports the resulting block honestly
 * rather than quietly dropping the signature. An admin who turned it on has to see that one
 * sentence and a signature do not fit.
 *
 * @param {object} voice     the persona voice block.
 * @param {object} [persona] `{name, signature}` -- the name appears in the sample.
 * @returns {{ok:boolean, blocks:Array, warnings:Array, replies:Array, chips:string[]}}
 */
export const renderVoiceSamples = (voice, persona = {}) => {
  const v = isObj(voice) ? voice : {};
  const register = VA_REGISTERS.includes(v.register) ? v.register : VA_DEFAULTS.persona.voice.register;
  const maxSentences = Number.isInteger(v.maxSentences) && v.maxSentences >= VA_MAX_SENTENCES_MIN && v.maxSentences <= VA_MAX_SENTENCES_MAX
    ? v.maxSentences
    : VA_DEFAULTS.persona.voice.maxSentences;
  const p = isObj(persona) ? persona : {};
  const name = clampPersonaName(p.name || "");
  const signature = p.signature === true && !!name;
  const greeting = v.greeting === true;

  // The signature is a sentence, so it comes out of the same budget. Never below one body
  // sentence: a sample with no body is not a sample.
  const bodyBudget = Math.max(1, maxSentences - (signature ? 1 : 0));

  const pools = SAMPLE_POOLS[register] || SAMPLE_POOLS.plain;
  const replies = pools.map((pool, i) => {
    const body = pool.slice(0, bodyBudget).map(String);
    if (greeting && body.length) {
      // The greeting is FOLDED INTO the first sentence rather than added as one, so turning
      // it on never costs a sentence of the budget.
      body[0] = `Hi there, ${body[0].charAt(0).toLowerCase()}${body[0].slice(1)}`;
    }
    let text = body.join(" ");
    if (signature) text += `\n${name}`;
    const lint = lintVoice(text, { register, maxSentences, language: v.language });
    return { kind: SAMPLE_KINDS[i] || `sample${i + 1}`, text, ok: lint.ok, blocks: lint.blocks, warnings: lint.warnings };
  });

  const blocks = [];
  const warnings = [];
  for (const r of replies) { blocks.push(...r.blocks); warnings.push(...r.warnings); }

  const chips = ["keep"];
  if (maxSentences > VA_MAX_SENTENCES_MIN) chips.push("shorter");
  if (register !== "warm") chips.push("warmer");
  if (register !== "terse") chips.push("terser");

  return { ok: blocks.length === 0, blocks, warnings, replies, chips };
};

/** Apply a sample chip to a voice block. An unknown chip is refused by the caller. */
const applyChip = (voice, chip) => {
  const v = { ...voice };
  const current = Number.isInteger(v.maxSentences) ? v.maxSentences : VA_DEFAULTS.persona.voice.maxSentences;
  if (chip === "shorter") v.maxSentences = Math.max(VA_MAX_SENTENCES_MIN, current - 1);
  if (chip === "warmer") v.register = v.register === "terse" ? "plain" : "warm";
  if (chip === "terser") v.register = v.register === "warm" ? "plain" : "terse";
  return v;
};

/* -- The JQL SHAPE check (and only the shape: see the header) ------------------- */

/**
 * A shape check for a JQL string. It proves NOTHING about whether the query runs: that is
 * F-424's dry `search` bounded to one result, and it lives in the resolver because only the
 * resolver can talk to Jira. What this catches is the class that would waste that call or
 * carry something odd into a prompt: unbalanced quotes and brackets, statement separators,
 * control characters and an over-long string.
 *
 * An EMPTY filter is fine. Intake can be queues or mentions alone, so "no JQL" is an
 * ordinary answer and not an error.
 *
 * @returns {{ok:boolean, reason?:string}}
 */
export const checkJqlShape = (value) => {
  if (value == null || value === "") return { ok: true };
  if (typeof value !== "string") return { ok: false, reason: "The JQL filter has to be text." };
  const s = value.trim();
  if (!s) return { ok: true };
  if (Array.from(s).length > VA_JQL_MAX) return { ok: false, reason: `The JQL filter is longer than ${VA_JQL_MAX} characters. Shorten it, or move part of it into a saved filter.` };
  if (CONTROL_RE.test(s)) return { ok: false, reason: "The JQL filter contains control characters, so it was not accepted." };
  if (s.includes(";")) return { ok: false, reason: "The JQL filter contains a semicolon. JQL is one query, not a list of statements." };
  if (!/[A-Za-z]/.test(s)) return { ok: false, reason: "The JQL filter has no field name in it." };
  const dq = (s.match(/"/g) || []).length;
  if (dq % 2 !== 0) return { ok: false, reason: "The JQL filter has an unclosed double quote." };
  const sq = (s.replace(/"[^"]*"/g, "").match(/'/g) || []).length;
  if (sq % 2 !== 0) return { ok: false, reason: "The JQL filter has an unclosed single quote." };
  let depth = 0;
  for (const ch of s.replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "")) {
    if (ch === "(") depth += 1;
    if (ch === ")") { depth -= 1; if (depth < 0) return { ok: false, reason: "The JQL filter closes a bracket it never opened." }; }
  }
  if (depth !== 0) return { ok: false, reason: "The JQL filter has an unclosed bracket." };
  if (/\b(and|or|not|in|was|changed)\s*$/i.test(s)) return { ok: false, reason: "The JQL filter ends on an operator, so it is incomplete." };
  return { ok: true };
};

/* -- Catalogue-derived options (the model's `options` never get here) ----------- */

const projectOptions = (catalog) => asArray(catalog && catalog.projects)
  .map((p) => (isObj(p) ? { value: String(p.key).toUpperCase(), label: String(p.name || p.key) } : { value: String(p).toUpperCase(), label: String(p) }))
  .filter((o) => VA_PROJECT_KEY_RE.test(o.value))
  .slice(0, VA_WIZARD_OPTIONS_MAX);

const deskOptions = (catalog) => asArray(catalog && catalog.serviceDesks)
  .slice(0, VA_WIZARD_OPTIONS_MAX)
  .map((d) => ({
    value: String(isObj(d) ? (d.id != null ? d.id : d.serviceDeskId) : d),
    label: String((isObj(d) && (d.name || d.projectName)) || (isObj(d) ? d.id : d)),
    queues: asArray(isObj(d) ? d.queues : null).slice(0, VA_QUEUES_PER_DESK_MAX).map((q) => ({
      value: String(isObj(q) ? q.id : q),
      label: String((isObj(q) && q.name) || (isObj(q) ? q.id : q)),
    })),
  }));

const skillOptions = (catalog) => asArray(catalog && catalog.skillIndex)
  .slice(0, VA_WIZARD_OPTIONS_MAX)
  .map((s) => (isObj(s) ? { value: String(s.id), label: String(s.name || s.id) } : { value: String(s), label: String(s) }));

/**
 * The options for a step, derived ONLY from the catalogue and the closed sets in
 * `va-config.js`. This is the function that makes "an option the catalogue does not carry
 * cannot be picked" true, so nothing here may fall back to a value the CALLER's model side
 * supplied.
 */
export const optionsForStep = (stepId, state) => {
  const catalog = isObj(state) && isObj(state.catalog) ? state.catalog : {};
  switch (stepId) {
    case "persona_voice":
      return VA_REGISTERS.map((r) => ({ value: r, label: r }));
    case "intake":
      return deskOptions(catalog);
    case "read_scope":
    case "write_scope":
      return projectOptions(catalog);
    case "cadence":
      return SCHEDULE_PRESETS.map((p) => ({ value: p.id, label: p.label }));
    case "powers":
      return VA_POWERS.map((p) => ({ value: p, label: p }));
    case "review":
      return STEP_IDS.slice(0, stepIndex("review")).map((id) => ({ value: id, label: id }));
    default:
      return [];
  }
};

/** The secondary catalogue lists and bounds a step needs beside its primary options. */
const extrasForStep = (stepId, state) => {
  const catalog = isObj(state) && isObj(state.catalog) ? state.catalog : {};
  if (stepId === "persona_name") return { maxChars: VA_PERSONA_NAME_MAX };
  if (stepId === "persona_voice") return { languages: [...VA_LANGUAGES], minSentences: VA_MAX_SENTENCES_MIN, maxSentences: VA_MAX_SENTENCES_MAX, chips: [...VOICE_SAMPLE_CHIPS] };
  if (stepId === "intake") return { maxDesks: VA_SERVICE_DESKS_MAX, maxQueuesPerDesk: VA_QUEUES_PER_DESK_MAX, maxMentions: VA_MENTIONS_MAX, maxJqlChars: VA_JQL_MAX };
  if (stepId === "read_scope" || stepId === "write_scope") return { maxProjects: VA_PROJECTS_MAX };
  if (stepId === "cadence") return { timeZones: asArray(catalog.timeZones).map(String).slice(0, VA_WIZARD_OPTIONS_MAX) };
  if (stepId === "powers") return { skills: skillOptions(catalog), maxSkills: VA_LIMITS.skillIds };
  if (stepId === "guardrails") return { ceilings: VA_CEILINGS, defaults: VA_DEFAULTS.guardrails, projects: projectOptions(catalog) };
  return {};
};

/* -- The record: answers -> the same `va` block the classic form builds --------- */

/**
 * Assemble the record from the answers gathered so far. Every unanswered step contributes
 * its DEFAULT, which is the least-privileged value, so a half-finished interview describes
 * an agent that can do nothing rather than one that can do everything. The record is handed
 * to `normalizeVa` for the real clamping, which is what makes the byte-identity property
 * between this door and the classic form hold.
 */
export const buildVaRecord = (state) => {
  const a = isObj(state) && isObj(state.answers) ? state.answers : {};
  const d = VA_DEFAULTS;
  return {
    persona: {
      name: a.personaName != null ? a.personaName : "",
      voice: isObj(a.voice) ? { ...d.persona.voice, ...a.voice } : { ...d.persona.voice },
      signature: typeof a.signature === "boolean" ? a.signature : d.persona.signature,
    },
    scope: {
      read: isObj(a.readScope) ? { site: a.readScope.site === true, projects: asArray(a.readScope.projects) } : { site: false, projects: [] },
      write: isObj(a.writeScope) ? { projects: asArray(a.writeScope.projects) } : { projects: [] },
    },
    intake: isObj(a.intake) ? { ...d.intake, ...a.intake } : { serviceDesks: [], jql: "", mentionsOf: [], owedFirst: d.intake.owedFirst },
    cadence: isObj(a.cadence) ? { ...clone(d.cadence), ...a.cadence } : clone(d.cadence),
    powers: isObj(a.powers) ? { ...d.powers, ...a.powers } : { ...d.powers, skillIds: [] },
    guardrails: isObj(a.guardrails) ? { ...d.guardrails, ...a.guardrails } : { ...d.guardrails },
    status: {
      paused: false,
      shadowUntilTick: (isObj(a.guardrails) && a.guardrails.shadowTicks != null) ? a.guardrails.shadowTicks : d.guardrails.shadowTicks,
    },
  };
};

/* -- Per-step validation. CODE decides; the catalogue is the evidence. ---------- */

const refusal = (field, reason) => ({ field, reason });

/** One integer answer against its published ceiling. Out of range is a REFUSAL, not a clamp. */
const intAnswer = (value, key, out, refused) => {
  const c = VA_CEILINGS[key];
  if (value === undefined) return;
  if (value === null || typeof value === "boolean" || typeof value === "object" || value === "") {
    refused.push(refusal(`guardrails.${key}`, `"${key}" needs a whole number between ${c.min} and ${c.max}.`));
    return;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    refused.push(refusal(`guardrails.${key}`, `"${clampChars(String(value), 20)}" is not a whole number, so "${key}" was not set.`));
    return;
  }
  if (n < c.min || n > c.max) {
    refused.push(refusal(`guardrails.${key}`, `"${key}" has to be between ${c.min} and ${c.max}. ${n} is outside that, so it was not set.`));
    return;
  }
  out[key] = n;
};

/**
 * Validate one step's answer against the catalogue and return either an answers patch or
 * the refusals. It NEVER returns a patch alongside a refusal for the same step: a value the
 * catalogue does not carry is refused whole, so nothing half-accepted lands in the state and
 * no admin is left guessing which half survived.
 *
 * The ONE documented exception is the persona name, which is charset- and length-CLAMPED and
 * accepted with a `notes[]` entry. A name is free text rather than a pick from a list, and an
 * admin who typed an accent that survived and a bracket that did not has to be told which.
 *
 * @returns {{patch?:object, refused:Array, notes:Array, stay?:boolean, goto?:string}}
 */
const validateAnswer = (stepId, value, state) => {
  const refused = [];
  const notes = [];
  const catalog = isObj(state.catalog) ? state.catalog : {};
  const projectKeys = Array.isArray(catalog.projects) ? catalog.projects.map((p) => String(isObj(p) ? p.key : p).toUpperCase()) : null;
  const answers = isObj(state.answers) ? state.answers : {};

  const keyList = (list, field, limit) => {
    const out = [];
    for (const raw of asArray(list).slice(0, limit)) {
      const key = String(isObj(raw) ? raw.key : raw).trim().toUpperCase();
      if (!VA_PROJECT_KEY_RE.test(key)) { refused.push(refusal(field, `"${clampChars(String(raw), 30)}" is not a project key.`)); continue; }
      if (projectKeys && !projectKeys.includes(key)) { refused.push(refusal(field, `Project ${key} is not one of the projects this app can see, so it cannot be used.`)); continue; }
      if (!out.includes(key)) out.push(key);
    }
    return out;
  };

  switch (stepId) {
    case "persona_name": {
      const raw = typeof value === "string" ? value : (isObj(value) && typeof value.name === "string" ? value.name : "");
      const name = clampPersonaName(raw);
      if (!name) {
        refused.push(refusal("persona.name", `A name is required, and it may only contain letters, digits, spaces, apostrophes, hyphens and dots, up to ${VA_PERSONA_NAME_MAX} characters. "${clampChars(String(raw), 30)}" leaves nothing usable.`));
        break;
      }
      if (name !== String(raw).trim()) notes.push(refusal("persona.name", `The name was reduced to "${name}". It may only contain letters, digits, spaces, apostrophes, hyphens and dots, up to ${VA_PERSONA_NAME_MAX} characters.`));
      return { patch: { personaName: name }, refused, notes };
    }

    case "persona_voice": {
      const current = isObj(answers.voice) ? answers.voice : { ...VA_DEFAULTS.persona.voice };
      if (isObj(value) && typeof value.chip === "string") {
        if (!VOICE_SAMPLE_CHIPS.includes(value.chip)) {
          refused.push(refusal("persona.voice", `"${clampChars(value.chip, 30)}" is not one of ${VOICE_SAMPLE_CHIPS.join(", ")}.`));
          break;
        }
        // "keep" accepts the sample as it stands and advances; the others adjust the voice
        // and re-render on the SAME step, because the admin is tuning, not answering.
        return { patch: { voice: value.chip === "keep" ? current : applyChip(current, value.chip) }, refused, notes, stay: value.chip !== "keep" };
      }
      if (!isObj(value)) { refused.push(refusal("persona.voice", "The voice needs a register and a sentence limit.")); break; }
      const voice = { ...current };
      if (value.register !== undefined) {
        if (!VA_REGISTERS.includes(value.register)) refused.push(refusal("persona.voice.register", `"${clampChars(String(value.register), 30)}" is not one of ${VA_REGISTERS.join(", ")}.`));
        else voice.register = value.register;
      }
      if (value.language !== undefined) {
        if (!VA_LANGUAGES.includes(value.language)) refused.push(refusal("persona.voice.language", `"${clampChars(String(value.language), 30)}" is not one of ${VA_LANGUAGES.join(", ")}.`));
        else voice.language = value.language;
      }
      if (value.maxSentences !== undefined) {
        const n = Number(value.maxSentences);
        if (!Number.isInteger(n) || n < VA_MAX_SENTENCES_MIN || n > VA_MAX_SENTENCES_MAX) refused.push(refusal("persona.voice.maxSentences", `A reply may run to between ${VA_MAX_SENTENCES_MIN} and ${VA_MAX_SENTENCES_MAX} sentences.`));
        else voice.maxSentences = n;
      }
      if (value.greeting !== undefined) {
        if (typeof value.greeting !== "boolean") refused.push(refusal("persona.voice.greeting", "The greeting is on or off."));
        else voice.greeting = value.greeting;
      }
      const patch = { voice };
      if (value.signature !== undefined) {
        if (typeof value.signature !== "boolean") refused.push(refusal("persona.signature", "The signature is on or off."));
        else patch.signature = value.signature;
      }
      if (refused.length) break;
      return { patch, refused, notes };
    }

    case "intake": {
      if (!isObj(value)) { refused.push(refusal("intake", "Intake needs queues, a filter or a mention list.")); break; }
      const catDesks = Array.isArray(catalog.serviceDesks) ? catalog.serviceDesks : null;
      const serviceDesks = [];
      for (const d of asArray(value.serviceDesks).slice(0, VA_SERVICE_DESKS_MAX)) {
        const id = String(isObj(d) ? (d.serviceDeskId != null ? d.serviceDeskId : d.id) : d).trim();
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) { refused.push(refusal("intake.serviceDesks", `"${clampChars(id, 20)}" is not a service desk id.`)); continue; }
        const known = catDesks ? catDesks.find((x) => String(isObj(x) ? (x.id != null ? x.id : x.serviceDeskId) : x) === id) : null;
        if (catDesks && !known) { refused.push(refusal("intake.serviceDesks", `Service desk ${id} was not found on this site, so it cannot be an intake source.`)); continue; }
        // The queue's own `jql` is read at save time by the resolver (the servicedeskapi
        // fallback in the plan's P4 row); the RECORD carries ids only, so nothing here
        // copies a query string onto it.
        const knownQueues = known ? asArray(known.queues).map((q) => String(isObj(q) ? q.id : q)) : null;
        const queueIds = [];
        for (const q of asArray(isObj(d) ? d.queueIds : null).slice(0, VA_QUEUES_PER_DESK_MAX)) {
          const qid = String(q).trim();
          if (!/^[A-Za-z0-9_-]{1,40}$/.test(qid)) { refused.push(refusal("intake.serviceDesks", `"${clampChars(qid, 20)}" is not a queue id.`)); continue; }
          if (knownQueues && !knownQueues.includes(qid)) { refused.push(refusal("intake.serviceDesks", `Queue ${clampChars(qid, 20)} is not a queue of service desk ${id}, so it cannot be an intake source.`)); continue; }
          if (!queueIds.includes(qid)) queueIds.push(qid);
        }
        serviceDesks.push({ serviceDeskId: id, queueIds });
      }
      const jqlCheck = checkJqlShape(value.jql);
      if (!jqlCheck.ok) refused.push(refusal("intake.jql", jqlCheck.reason));
      const mentionsOf = [];
      for (const m of asArray(value.mentionsOf).slice(0, VA_MENTIONS_MAX)) {
        const id = String(isObj(m) ? m.accountId : m).trim();
        if (!/^[a-zA-Z0-9:_.\-|]{1,128}$/.test(id)) { refused.push(refusal("intake.mentionsOf", `"${clampChars(id, 20)}" is not an account id.`)); continue; }
        if (!mentionsOf.includes(id)) mentionsOf.push(id);
      }
      if (value.owedFirst !== undefined && typeof value.owedFirst !== "boolean") refused.push(refusal("intake.owedFirst", "Answering people who are waiting first is on or off."));
      if (refused.length) break;
      return {
        patch: {
          intake: {
            serviceDesks,
            jql: typeof value.jql === "string" ? value.jql.trim() : "",
            mentionsOf,
            owedFirst: value.owedFirst === undefined ? VA_DEFAULTS.intake.owedFirst : value.owedFirst,
          },
        },
        refused, notes,
      };
    }

    case "read_scope": {
      const v = isObj(value) ? value : { projects: value };
      const site = v.site === true;
      const projects = site ? [] : keyList(v.projects, "scope.read.projects", VA_PROJECTS_MAX);
      if (refused.length) break;
      if (!site && !projects.length) { refused.push(refusal("scope.read.projects", "An agent that may read nothing has nothing to work on. Name at least one project, or let it read everything this app can see.")); break; }
      return { patch: { readScope: { site, projects } }, refused, notes };
    }

    case "write_scope": {
      const v = isObj(value) ? value : { projects: value };
      if (v.site === true) { refused.push(refusal("scope.write.site", writeSiteRefusalReason())); break; }
      const projects = keyList(v.projects, "scope.write.projects", VA_PROJECTS_MAX);
      if (refused.length) break;
      const read = isObj(answers.readScope) ? answers.readScope : { site: false, projects: [] };
      if (read.site !== true) {
        const outside = projects.filter((k) => !asArray(read.projects).includes(k));
        for (const k of outside) refused.push(refusal("scope.write.projects", `Project ${k} is not in the read scope. An agent cannot write where it cannot read, so add it to the read scope first or drop it here.`));
        if (refused.length) break;
      }
      return { patch: { writeScope: { projects } }, refused, notes };
    }

    case "cadence": {
      if (!isObj(value)) { refused.push(refusal("cadence", "The cadence needs a preset.")); break; }
      const presetIds = SCHEDULE_PRESETS.map((p) => p.id);
      if (!presetIds.includes(value.preset)) { refused.push(refusal("cadence.preset", `"${clampChars(String(value.preset), 30)}" is not a cadence this app offers.`)); break; }
      const cadence = { preset: value.preset };
      if (value.preset === "custom") {
        if (typeof value.cron !== "string" || !value.cron.trim()) { refused.push(refusal("cadence.cron", "A custom cadence needs a cron expression.")); break; }
        cadence.cron = value.cron.trim().replace(/\s+/g, " ");
      } else {
        // The hour/minute/day options a preset needs pass straight through to `presetToCron`
        // inside normalizeVa. The cron string itself is never authored here: cron.js is the
        // one home for the maths, and a second author is how the two start disagreeing.
        for (const k of ["hour", "minute", "weekday", "day"]) if (value[k] !== undefined) cadence[k] = value[k];
      }
      const zones = Array.isArray(catalog.timeZones) && catalog.timeZones.length ? catalog.timeZones.map(String) : null;
      const zone = String(value.timeZone == null ? "" : value.timeZone).trim();
      if (zone) {
        if (zones && !zones.includes(zone)) { refused.push(refusal("cadence.timeZone", `"${clampChars(zone, 40)}" is not one of the time zones this site offers.`)); break; }
        cadence.timeZone = zone;
      } else cadence.timeZone = VA_DEFAULTS.cadence.timeZone;
      if (value.postWindow !== undefined) {
        const w = isObj(value.postWindow) ? value.postWindow : null;
        if (!w) { refused.push(refusal("cadence.postWindow", "The posting window needs days and a from/to time.")); break; }
        const days = asArray(w.days).map(Number);
        if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) { refused.push(refusal("cadence.postWindow.days", "A posting day is a number from 0 (Sunday) to 6 (Saturday).")); break; }
        const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
        for (const k of ["from", "to"]) {
          if (w[k] !== undefined && !hhmm.test(String(w[k]))) refused.push(refusal(`cadence.postWindow.${k}`, `"${clampChars(String(w[k]), 10)}" is not a time of day. Use HH:MM.`));
        }
        if (refused.length) break;
        cadence.postWindow = {
          days: [...new Set(days)].sort((x, y) => x - y),
          from: w.from === undefined ? VA_DEFAULTS.cadence.postWindow.from : String(w.from),
          to: w.to === undefined ? VA_DEFAULTS.cadence.postWindow.to : String(w.to),
        };
      }
      return { patch: { cadence }, refused, notes };
    }

    case "powers": {
      if (!isObj(value)) { refused.push(refusal("powers", "Pick which powers are on.")); break; }
      const powers = {};
      for (const k of Object.keys(value)) {
        if (k === "skillIds") continue;
        if (!VA_POWERS.includes(k)) {
          refused.push(refusal(`powers.${k}`, `"${clampChars(k, 30)}" is not a power a Virtual Administrator has. Configuration changes in particular have no action at all, so the agent can only propose them.`));
          continue;
        }
        if (typeof value[k] !== "boolean") { refused.push(refusal(`powers.${k}`, `"${k}" is on or off.`)); continue; }
        powers[k] = value[k];
      }
      const skillIndex = Array.isArray(catalog.skillIndex) ? catalog.skillIndex.map((s) => String(isObj(s) ? s.id : s)) : null;
      const skillIds = [];
      for (const s of asArray(value.skillIds)) {
        const id = String(isObj(s) ? s.id : s).trim();
        if (!id || !/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) { refused.push(refusal("powers.skillIds", `"${clampChars(id, 30)}" is not a skill id.`)); continue; }
        if (skillIndex && !skillIndex.includes(id)) { refused.push(refusal("powers.skillIds", `Skill ${clampChars(id, 30)} does not exist, so it cannot be bound to this agent.`)); continue; }
        if (skillIds.includes(id)) continue;
        if (skillIds.length >= VA_LIMITS.skillIds) { refused.push(refusal("powers.skillIds", `An agent may bind at most ${VA_LIMITS.skillIds} skills. A rule picks a voice, not a library.`)); continue; }
        skillIds.push(id);
      }
      if (refused.length) break;
      return { patch: { powers: { ...powers, skillIds } }, refused, notes };
    }

    case "guardrails": {
      if (!isObj(value)) { refused.push(refusal("guardrails", "The guardrails need numbers.")); break; }
      const out = {};
      for (const k of Object.keys(value)) {
        if (k === "approvalProjectKey") continue;
        if (!Object.prototype.hasOwnProperty.call(VA_CEILINGS, k)) {
          // Includes the two DROPPED fields (F-412 `owedUncapped`, F-425 `maxBulkTargets`):
          // they are not in VA_CEILINGS, so they are refused by name here and `normalizeVa`
          // never has to see them. Their full explanations live in va-config.js, once.
          refused.push(refusal(`guardrails.${k}`, `"${clampChars(k, 40)}" is not a guardrail this agent has, so it was not set.`));
          continue;
        }
        intAnswer(value[k], k, out, refused);
      }
      if (value.approvalProjectKey !== undefined) {
        const raw = String(value.approvalProjectKey == null ? "" : value.approvalProjectKey).trim().toUpperCase();
        if (raw) {
          const [only] = keyList([raw], "guardrails.approvalProjectKey", 1);
          if (only) out.approvalProjectKey = only;
        } else out.approvalProjectKey = "";
      }
      if (refused.length) break;
      return { patch: { guardrails: out }, refused, notes };
    }

    case "review": {
      const v = isObj(value) ? value : {};
      if (typeof v.back === "string") {
        if (!STEP_IDS.includes(v.back) || stepIndex(v.back) >= stepIndex("review")) {
          refused.push(refusal("review", `"${clampChars(v.back, 40)}" is not a step of this interview.`));
          break;
        }
        return { patch: {}, refused, notes, goto: v.back };
      }
      if (v.confirm !== true) { refused.push(refusal("review", "Confirm the summary, or name a step to go back to.")); break; }
      return { patch: {}, refused, notes };
    }

    case "create": {
      const v = isObj(value) ? value : {};
      if (v.confirm !== true) { refused.push(refusal("create", "Confirm to create the agent.")); break; }
      return { patch: {}, refused, notes };
    }

    default:
      refused.push(refusal("step", `"${clampChars(String(stepId), 40)}" is not a step of this interview.`));
  }
  return { refused, notes };
};

/* -- State -------------------------------------------------------------------- */

/**
 * A fresh interview. `catalog` is the LIVE data the resolver fetched this turn; it is not
 * part of what gets persisted (see `serializeWizardState`) because it is refetched anyway
 * and it is larger than the KVS budget the whole state has to fit in.
 *
 * @returns {{state: object, step: function}}
 */
export const createWizard = (opts = {}) => {
  const o = isObj(opts) ? opts : {};
  const state = {
    v: VA_WIZARD_VERSION,
    stepId: STEP_IDS[0],
    answers: isObj(o.answers) ? clone(o.answers) : {},
    history: [],
    refused: [],
    notes: [],
    done: false,
    catalog: isObj(o.catalog) ? o.catalog : {},
  };
  return { state, step: stepWizard };
};

/** Remember one line. The history is the chat transcript, never a source of truth. */
const pushHistory = (history, role, text) => {
  const t = clampChars(String(text == null ? "" : text).replace(/\s+/g, " ").trim(), VA_WIZARD_HISTORY_TEXT_MAX);
  if (!t) return history;
  return [...history, { r: role === "admin" ? "u" : "a", t }].slice(-VA_WIZARD_HISTORY_MAX);
};

/**
 * The state as the resolver stores it at `va_wizard:{accountId}`.
 *
 * The catalogue is DROPPED (live data, refetched every turn) and `history` is trimmed from
 * the OLDEST end until the whole value fits `VA_WIZARD_STATE_MAX_BYTES`. Trimming the
 * transcript rather than the answers is deliberate: losing chat bubbles costs an admin
 * nothing on resume, losing an answer costs them the interview.
 *
 * @returns {{state:object, bytes:number, truncated:boolean}}
 */
export const serializeWizardState = (state) => {
  const s = isObj(state) ? state : {};
  const out = {
    v: VA_WIZARD_VERSION,
    stepId: STEP_IDS.includes(s.stepId) ? s.stepId : STEP_IDS[0],
    answers: isObj(s.answers) ? clone(s.answers) : {},
    history: asArray(s.history).slice(-VA_WIZARD_HISTORY_MAX),
    refused: asArray(s.refused).slice(0, 20),
    notes: asArray(s.notes).slice(0, 20),
    done: s.done === true,
  };
  const size = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
  // Any drop is REPORTED, including the fixed-length window above: the caller renders
  // "earlier messages are not kept" rather than letting a transcript quietly lose its head.
  let truncated = asArray(s.history).length > out.history.length;
  while (size(out) > VA_WIZARD_STATE_MAX_BYTES && out.history.length) { out.history.shift(); truncated = true; }
  if (size(out) > VA_WIZARD_STATE_MAX_BYTES && (out.refused.length || out.notes.length)) { out.refused = []; out.notes = []; truncated = true; }
  return { state: out, bytes: size(out), truncated };
};

/**
 * Restore a stored interview and re-attach THIS turn's live catalogue. A stored state from
 * another version, or standing on a step this build does not have, restarts the interview
 * rather than being migrated: a half-understood resume is how an answer ends up on the wrong
 * field.
 */
export const resumeWizard = (stored, catalog) => {
  if (!isObj(stored) || stored.v !== VA_WIZARD_VERSION || !STEP_IDS.includes(stored.stepId)) {
    return createWizard({ catalog }).state;
  }
  return {
    v: VA_WIZARD_VERSION,
    stepId: stored.stepId,
    answers: isObj(stored.answers) ? clone(stored.answers) : {},
    history: asArray(stored.history).slice(-VA_WIZARD_HISTORY_MAX),
    refused: [],
    notes: [],
    done: stored.done === true,
    catalog: isObj(catalog) ? catalog : {},
  };
};

/* -- Rendering a turn ---------------------------------------------------------- */

/**
 * The plain-sentence summary of the record. No bullets and no bold: the voice rules govern
 * the AGENT's own copy rather than the admin UI, but a review card written in the shape the
 * agent is forbidden to use reads as a different product, and prose here keeps the surface
 * honest. The guardrail half is NOT written here at all, it comes from
 * `renderGuardrailSentences`, which is the same text the item turn's prompt receives.
 */
export const renderReviewSummary = (va) => {
  const r = isObj(va) ? va : {};
  const persona = isObj(r.persona) ? r.persona : VA_DEFAULTS.persona;
  const scope = isObj(r.scope) ? r.scope : VA_DEFAULTS.scope;
  const intake = isObj(r.intake) ? r.intake : VA_DEFAULTS.intake;
  const cadence = isObj(r.cadence) ? r.cadence : VA_DEFAULTS.cadence;
  const powers = isObj(r.powers) ? r.powers : VA_DEFAULTS.powers;
  const out = [];

  out.push(`${persona.name} runs on the ${cadence.preset} cadence in ${cadence.timeZone}, and posts between ${cadence.postWindow.from} and ${cadence.postWindow.to}.`);

  const sources = [];
  const desks = asArray(intake.serviceDesks);
  const mentions = asArray(intake.mentionsOf);
  if (desks.length) sources.push(`${desks.length} service desk source${desks.length === 1 ? "" : "s"}`);
  if (intake.jql) sources.push("a JQL filter");
  if (mentions.length) sources.push(`mentions of ${mentions.length} ${mentions.length === 1 ? "person" : "people"}`);
  out.push(sources.length ? `It picks up work from ${sources.join(", ")}.` : "It has no intake source yet, so it will find nothing to work on.");

  out.push(scope.read.site
    ? "It reads every project this app can see."
    : `It reads ${asArray(scope.read.projects).join(", ") || "no project"}.`);
  out.push(asArray(scope.write.projects).length
    ? `It may change issues in ${scope.write.projects.join(", ")} and nowhere else.`
    : "It changes nothing. It reads, stages replies and proposes changes.");

  const on = VA_POWERS.filter((k) => powers[k]);
  out.push(on.length ? `Its powers are ${on.join(", ")}.` : "It has no powers turned on.");
  const skills = asArray(powers.skillIds);
  if (skills.length) out.push(`It is bound to ${skills.length} skill${skills.length === 1 ? "" : "s"}.`);
  if (intake.jql) out.push("The JQL filter is run against Jira once before the agent is created. If it cannot run, the agent is not created.");
  return out;
};

/** Render the turn for a state. Pure: it reads the state, it never changes it. */
const renderTurn = (state, prompt, extra = {}) => {
  const stepId = state.stepId;
  const def = stepAt(stepId) || WIZARD_STEPS[0];
  const turn = {
    state,
    stepId,
    field: def.field,
    ask: def.ask,
    prompt: prompt || def.ask,
    options: optionsForStep(stepId, state),
    extras: extrasForStep(stepId, state),
    refused: asArray(state.refused),
    notes: asArray(state.notes),
    done: state.done === true,
    ...extra,
  };

  if (stepId === "persona_voice") {
    const record = buildVaRecord(state);
    // FAILS OPEN by contract: a sample that cannot be linted still renders, labelled
    // unchecked. Nothing is sent from the wizard, so a lint fault must not block setup.
    try {
      turn.sample = renderVoiceSamples(record.persona.voice, record.persona);
    } catch (e) {
      turn.sample = { ok: false, unchecked: true, blocks: [], warnings: [], replies: [], chips: ["keep"], error: String(e && e.message ? e.message : e) };
    }
  }

  if (stepId === "review" || stepId === "create") {
    const record = buildVaRecord(state);
    try {
      const { va, refused } = normalizeVa(record, catalogToCtx(state.catalog));
      turn.summary = renderReviewSummary(va);
      turn.guardrailSentences = renderGuardrailSentences(va);
      turn.preview = va;
      if (refused.length) turn.notes = [...turn.notes, ...refused];
    } catch (e) {
      // A record the save path refuses cannot be reviewed into existence. Fail CLOSED into
      // the classic form, holding everything already answered.
      turn.summary = [];
      turn.guardrailSentences = [];
      turn.refused = [...turn.refused, refusal("record", String(e && e.message ? e.message : e))];
      turn.fallbackToForm = true;
    }
  }
  return turn;
};

/* -- step() -------------------------------------------------------------------- */

/**
 * Advance the interview by one turn. PURE: `state` is never mutated, a new one is returned.
 *
 * @param {object} state  the current state (`createWizard().state` or `resumeWizard`).
 * @param {object} input  ONE of:
 *   - `{}` / null       render the current step (the opening turn).
 *   - `{answer: value}` the admin's typed or picked answer.
 *   - `{model: {say, ask, field, options?, done, value?}}` the model's strict JSON.
 * @returns {{state, stepId, field, ask, prompt, options, extras, refused, notes, done,
 *            sample?, summary?, guardrailSentences?, preview?, va?, created?,
 *            fallbackToForm?, record?}}
 */
export const stepWizard = (state, input) => {
  const base = isObj(state) && STEP_IDS.includes(state.stepId)
    ? state
    : createWizard({ catalog: isObj(state) ? state.catalog : {} }).state;
  const next = {
    v: VA_WIZARD_VERSION,
    stepId: base.stepId,
    answers: isObj(base.answers) ? clone(base.answers) : {},
    history: asArray(base.history).slice(-VA_WIZARD_HISTORY_MAX),
    refused: [],
    notes: [],
    done: base.done === true,
    catalog: isObj(base.catalog) ? base.catalog : {},
  };

  const inp = isObj(input) ? input : {};
  const def = stepAt(next.stepId);
  let prompt = "";
  let value;
  let hasValue = false;

  if (isObj(inp.model)) {
    const m = inp.model;
    prompt = clampSay(m.say);
    if (prompt) next.history = pushHistory(next.history, "agent", prompt);
    // `field` NAMES the step; it never selects one. Anything else is a refusal.
    const named = typeof m.field === "string" ? m.field : "";
    if (named && named !== def.id && named !== def.field) {
      next.refused.push(refusal("field", `The setup assistant asked about "${clampChars(named, 40)}", which is not the question on the table. The next thing to settle is ${def.field}.`));
      return renderTurn(next, prompt);
    }
    if (m.done === true && def.id !== "create") {
      next.refused.push(refusal("done", `The setup assistant tried to finish at "${def.id}". The interview finishes at the create step and nowhere else.`));
      return renderTurn(next, prompt);
    }
    if (Array.isArray(m.options) && m.options.length) {
      next.notes.push(refusal("options", "The choices offered were replaced by the ones this site actually has."));
    }
    if (m.value !== undefined) { value = m.value; hasValue = true; }
  } else if (Object.prototype.hasOwnProperty.call(inp, "answer")) {
    value = inp.answer;
    hasValue = true;
    next.history = pushHistory(next.history, "admin", typeof value === "string" ? value : JSON.stringify(value));
  }

  if (!hasValue) return renderTurn(next, prompt);

  const result = validateAnswer(next.stepId, value, next);
  next.refused = [...next.refused, ...asArray(result.refused)];
  next.notes = [...next.notes, ...asArray(result.notes)];
  if (next.refused.length || !result.patch) return renderTurn(next, prompt);

  next.answers = { ...next.answers, ...result.patch };

  // A chip that changes the voice re-renders the sample on the SAME step.
  if (result.stay) return renderTurn(next, prompt);
  if (result.goto) { next.stepId = result.goto; return renderTurn(next, prompt); }

  if (next.stepId === "create") {
    const record = buildVaRecord(next);
    try {
      const { va, refused } = normalizeVa(record, catalogToCtx(next.catalog));
      next.done = true;
      next.notes = [...next.notes, ...refused];
      return renderTurn(next, prompt, { va, refused, created: true, done: true });
    } catch (e) {
      next.refused.push(refusal("record", String(e && e.message ? e.message : e)));
      return renderTurn(next, prompt, { fallbackToForm: true, record });
    }
  }

  next.stepId = STEP_IDS[Math.min(stepIndex(next.stepId) + 1, STEP_IDS.length - 1)];
  return renderTurn(next, prompt);
};
