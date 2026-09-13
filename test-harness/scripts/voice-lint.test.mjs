/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/voice-lint.js — post gate 9 and the wizard's live
// voice sample (release 1.5, commit 1). Auto-discovered by run-offline.mjs.
//
// Three properties, in order of what a regression here would cost:
//   1. Every hard block fires (BLOCK) and does not fire on clean text (ALLOW).
//   2. The corpus holds: the six human samples lint clean, the six AI-shaped samples are
//      blocked, each on a different rule. A table that goes empty fails HERE.
//   3. NO FIXTURE TEXT LEAKS into the result. The result travels into receipts, logs,
//      REST answers and the next turn's prompt, so it carries rule ids and sentence
//      INDEXES, never the sentence.
// Run: node scripts/voice-lint.test.mjs
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintVoice, splitSentences, VOICE_BLOCKS, VOICE_WARNINGS } from "../../src/shared/voice-lint.js";
import { VOICE_RULES_TABLES, BANNED_OPENERS, METHOD_LEAKS, SIGN_OFFS, AI_DISCLAIMERS, REGISTER_WORD_CAPS } from "../../src/shared/voice-rules-data.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "../fixtures/voice");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const PLAIN = { register: "plain", maxSentences: 3, language: "en" };
const ruleIds = (r) => r.blocks.map((b) => b.rule);
const blocked = (text, rule, voice = PLAIN) => {
  const r = lintVoice(text, voice);
  ok(r.ok === false && ruleIds(r).includes(rule), `BLOCK ${rule} (got ${JSON.stringify(ruleIds(r))})`);
  return r;
};

/* ── 1. the tables are not empty (the failure mode a pack swap introduces) ─────── */
ok(BANNED_OPENERS.length >= 10, "banned openers table is populated");
ok(METHOD_LEAKS.length >= 10, "method leak table is populated");
ok(SIGN_OFFS.length >= 10, "sign-off table is populated");
ok(AI_DISCLAIMERS.length >= 8, "AI disclaimer table is populated");
ok(Object.keys(REGISTER_WORD_CAPS).length === 3, "one word cap per register");
ok(VOICE_RULES_TABLES.bannedOpeners === BANNED_OPENERS, "the bundle exposes the same array, not a copy");
ok(VOICE_BLOCKS.length === 14 && VOICE_WARNINGS.length === 4, "the rule id lists are stable");

/* ── 2. a clean message passes ─────────────────────────────────────────────────── */
{
  const r = lintVoice("Done. The scheme was missing the group, so I added it back.", PLAIN);
  ok(r.ok === true && r.blocks.length === 0, `ALLOW clean message (got ${JSON.stringify(r.blocks)})`);
}

/* ── 3. BLOCK per rule ─────────────────────────────────────────────────────────── */
blocked("", "empty");
blocked("   \n  ", "empty");
blocked("Done.\n- one thing\n- another thing", "markdown_bullet");
blocked("Done.\n1. one thing\n2. another", "markdown_bullet");
blocked("# Status\nDone.", "markdown_heading");
blocked("That is **done** now.", "markdown_bold");
blocked("Run `forge deploy` next.", "markdown_backtick");
blocked("It is fixed — try again.", "em_dash");
blocked("It is fixed – try again.", "em_dash");
blocked("It is fixed -- try again.", "em_dash");
blocked("As an AI I cannot approve this.", "ai_disclaimer");
blocked("I am a bot and cannot approve this.", "ai_disclaimer");
blocked("Certainly, the change is live.", "banned_opener");
blocked("Great question! It is live now.", "banned_opener");
blocked("I ran a query and found three matches.", "method_leak");
blocked("It is live now. I checked it via the API.", "method_leak");
blocked("The access is granted.\n\nBest regards", "sign_off");
blocked("The access is granted. Kind regards.", "sign_off");
blocked("One. Two things happened here today. Three more are still open somewhere. Four is the last of them.", "over_max_sentences");
blocked(`Ok. ${Array.from({ length: 50 }, () => "word").join(" ")} here.`, "long_sentence");
blocked("The pipeline was reconfigured yesterday by the platform team. Your reports now use the updated source without any problems. Please confirm on your side that the output looks right.", "no_short_sentence");
blocked(`Ok. ${Array.from({ length: 60 }, () => "word").join(" ")}.`, "register_word_cap", { register: "terse", maxSentences: 4 });

/* ── 4. ALLOW per rule: the near-miss that must NOT block ──────────────────────── */
{
  const allow = (text, notRule, voice = PLAIN, why = "") => {
    const r = lintVoice(text, voice);
    ok(!ruleIds(r).includes(notRule), `ALLOW ${notRule} ${why} (got ${JSON.stringify(ruleIds(r))})`);
  };
  // A hyphen is not an em dash; a minus inside a word is not a dash rule.
  allow("The re-index finished and the on-call rota is updated.", "em_dash", PLAIN, "hyphenated words");
  // The opener words mid-sentence are ordinary English.
  allow("I know you understand the constraint here.", "banned_opener", PLAIN, "opener word mid-sentence");
  allow("That regards the invoice, not the licence.", "sign_off", PLAIN, "sign-off word mid-sentence");
  // Two sentences never trip burstiness, whatever their length.
  allow("The pipeline was reconfigured yesterday by the platform team. Your reports now use the updated source.", "no_short_sentence", PLAIN, "under the burstiness sentence floor");
  // A number with a decimal point is not a sentence break that pushes it over the cap.
  const r = lintVoice("Version 2.1 is live. Ping me if it misbehaves.", PLAIN);
  ok(r.ok === true, `ALLOW decimal point does not split a sentence (got ${JSON.stringify(r.blocks)})`);
  // warm affords more words than terse for the SAME text.
  const long = `Ok. ${Array.from({ length: 60 }, () => "word").join(" ")}.`;
  ok(ruleIds(lintVoice(long, { register: "terse", maxSentences: 4 })).includes("register_word_cap")
    && !ruleIds(lintVoice(long, { register: "warm", maxSentences: 4 })).includes("register_word_cap"),
    "ALLOW the register decides the word cap");
}

/* ── 5. defaults fail toward the RESTRICTIVE end, never toward "no limit" ──────── */
{
  const four = "One. Two things happened here today. Three more are still open. Four is last.";
  ok(ruleIds(lintVoice(four, {})).includes("over_max_sentences"), "a missing maxSentences falls back to 3, not to unlimited");
  ok(ruleIds(lintVoice(four, { maxSentences: 0 })).includes("over_max_sentences"), "a zero maxSentences falls back to 3");
  const r = lintVoice("Ok. " + Array.from({ length: 100 }, () => "word").join(" ") + ".", { register: "nonsense-register" });
  ok(ruleIds(r).includes("register_word_cap"), "an unknown register falls back to the default cap, not to no cap");
  // Non-string input is empty text, and empty text is a BLOCK. It never throws.
  for (const bad of [null, undefined, 42, {}, [], true]) {
    const rr = lintVoice(bad, PLAIN);
    ok(rr.ok === false && ruleIds(rr).includes("empty"), `non-string input (${typeof bad}) blocks as empty`);
  }
  // Empty tables must not turn the phrase rules into silent passes for the STRUCTURAL
  // rules — the structure half of the linter is code, not data.
  const none = { ...VOICE_RULES_TABLES, bannedOpeners: [], methodLeaks: [], signOffs: [], aiDisclaimers: [] };
  const r2 = lintVoice("Certainly. It is fixed — I ran a query.", PLAIN, none);
  ok(!ruleIds(r2).includes("banned_opener") && ruleIds(r2).includes("em_dash"),
    "empty tables disable only their own rules, never the structural ones");
}

/* ── 6. soft warnings are recorded and never block ─────────────────────────────── */
{
  const r = lintVoice("Done! It works now!", PLAIN);
  ok(r.warnings.some((w) => w.rule === "exclamations"), "exclamations are warned about");
  ok(r.ok === true, "a warning does not block");
  const e = lintVoice("Done. It works now 🎉", PLAIN);
  ok(e.warnings.some((w) => w.rule === "emoji") && e.ok === true, "an emoji warns and does not block");
  const q = lintVoice("Which one? What time? Who asked?", PLAIN);
  ok(q.warnings.some((w) => w.rule === "question_pile"), "a pile of questions warns");
}

/* ── 7. the corpus ─────────────────────────────────────────────────────────────── */
const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".txt")).sort();
const humans = files.filter((f) => f.startsWith("human-"));
const ais = files.filter((f) => f.startsWith("ai-"));
ok(humans.length >= 6, `at least six human samples (${humans.length})`);
ok(ais.length >= 6, `at least six AI-shaped samples (${ais.length})`);

const seenRules = new Set();
for (const f of humans) {
  const text = readFileSync(path.join(fixtureDir, f), "utf8");
  const r = lintVoice(text, PLAIN);
  ok(r.ok === true, `corpus ${f} lints CLEAN (blocked on ${JSON.stringify(ruleIds(r))})`);
}
for (const f of ais) {
  const text = readFileSync(path.join(fixtureDir, f), "utf8");
  const r = lintVoice(text, PLAIN);
  ok(r.ok === false, `corpus ${f} is BLOCKED`);
  for (const id of ruleIds(r)) seenRules.add(id);
}
// Each AI sample exists for a different rule: if they all tripped the same one, five of
// the six would be proving nothing.
ok(seenRules.size >= 6, `the AI corpus exercises at least six distinct rules (${[...seenRules].join(", ")})`);

/* ── 8. NOTHING THE AUTHOR WROTE COMES BACK OUT ────────────────────────────────── */
{
  const tablePhrases = new Set([...BANNED_OPENERS, ...METHOD_LEAKS, ...SIGN_OFFS, ...AI_DISCLAIMERS].map((p) => p.toLowerCase()));
  for (const f of [...humans, ...ais]) {
    const text = readFileSync(path.join(fixtureDir, f), "utf8");
    const r = lintVoice(text, PLAIN);
    const serialised = JSON.stringify(r).toLowerCase();
    // Every string in the result is either a known rule id or a phrase from OUR table.
    const strings = [];
    const walk = (v) => { if (typeof v === "string") strings.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
    walk(r);
    for (const s of strings) {
      ok(VOICE_BLOCKS.includes(s) || VOICE_WARNINGS.includes(s) || tablePhrases.has(s.toLowerCase()),
        `${f}: result string "${s.slice(0, 30)}" is a rule id or a table phrase, not author text`);
    }
    // And the belt to that brace: no word of six letters or more from the sample appears
    // in the serialised result unless it came from a table phrase.
    const tableWords = new Set([...tablePhrases].flatMap((p) => p.split(/\s+/)));
    for (const w of new Set(text.toLowerCase().match(/[a-z]{6,}/g) || [])) {
      if (tableWords.has(w)) continue;
      ok(!serialised.includes(w), `${f}: the word "${w}" does not leak into the lint result`);
    }
  }
}

/* ── 9. sentence splitting is the shape the gate counts on ─────────────────────── */
ok(splitSentences("One. Two! Three?").length === 3, "terminators split sentences");
ok(splitSentences("One.\nTwo.").length === 2, "a line break splits a sentence");
ok(splitSentences("   ").length === 0, "blank text has no sentences");
ok(splitSentences("Version 2.1 is live.").length === 1, "a decimal does not split");

console.log(`VOICE LINT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
