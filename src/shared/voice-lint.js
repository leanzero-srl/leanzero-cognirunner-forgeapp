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
 * THE OUTWARD-TEXT CONTRACT — post gate 9 and the wizard's live voice sample, one
 * function (release 1.5, commit 1).
 *
 * A Virtual Administrator writes in a ticket that customers and colleagues read. The
 * thing that gives generated text away is not its content, it is its SHAPE: bullets in a
 * two-line reply, an em-dash in every other sentence, "Certainly!" as an opener, a
 * letter-style sign-off, three sentences of exactly the same length. This module is the
 * code that refuses that shape, so the promise is a guarantee and not a prompt sentence
 * the model may ignore on its fourth round (LAW 2).
 *
 * RULES HERE, WORDS ELSEWHERE (F-420). The tables are the third argument: the linter
 * never owns a banned phrase, and the wizard sample, the persona prompt and this gate all
 * read the SAME data. `src/shared/voice-rules-data.js` is that home TODAY; the
 * `voice-rules` knowledge pack REPLACES it in 1.4 commit 14b, and when it does, nothing
 * in this file changes. That is the whole reason the tables are injected rather than
 * imported.
 *
 * FAIL CONTRACT (LAW 3) — the two callers are DIFFERENT PRODUCTS and must stay different:
 *   - THE POST GATE FAILS CLOSED. A lint that throws blocks the post. A draft that could
 *     not be checked is a draft nobody checked, and an unchecked message to a customer is
 *     the failure this surface exists to prevent. The caller wraps this in try/catch and
 *     treats a throw as `{ok:false}`.
 *   - THE WIZARD PREVIEW FAILS OPEN. A sample that cannot be linted still renders,
 *     labelled as unchecked. Nothing is sent from the wizard, so a broken check there
 *     must not block an admin from finishing setup.
 * This function itself never throws on ordinary input (a null, a number and an object all
 * lint as empty text); the contract above is about what the CALLERS do with a fault.
 *
 * WHAT IT NEVER RETURNS: the text. `blocks[]` carries the rule id, the 1-based INDEX of
 * the offending sentence and — only for a table match — the table phrase that matched,
 * which is OUR word, not the author's. No user-supplied substring is ever echoed back,
 * because the result travels into logs, receipts, REST answers and the next turn's prompt,
 * and a linter that quotes the text it rejected re-injects it everywhere.
 *
 * DEFANGING IS THE CALLER'S (this module is dependency-free). `defangFence` lives in
 * `src/memories.js`, which imports `@forge/kvs` at load, so `src/shared/*` cannot import
 * it without breaking both webpack builds. The post gate defangs the draft BEFORE it lints
 * it and BEFORE it fences it into a prompt; this module assumes it is looking at text that
 * has already been through that.
 *
 * JUDGEMENT VS GUARANTEE. Everything here is a SHAPE check — counted, matched, structural.
 * Whether the reply is correct, kind or relevant is a judgement and belongs to the model.
 * Do not grow this file into a content filter with a word list.
 */

import { VOICE_RULES_TABLES } from "./voice-rules-data.js";

/** The block ids, so callers, tests and receipts spell them the same way. */
export const VOICE_BLOCKS = Object.freeze([
  "empty",
  "markdown_bullet",
  "markdown_heading",
  "markdown_bold",
  "markdown_backtick",
  "em_dash",
  "ai_disclaimer",
  "banned_opener",
  "method_leak",
  "sign_off",
  "over_max_sentences",
  "long_sentence",
  "no_short_sentence",
  "register_word_cap",
]);

/** The soft-warning ids. Recorded on the item, never blocking. */
export const VOICE_WARNINGS = Object.freeze([
  "exclamations",
  "question_pile",
  "emoji",
  "repeated_sentence_opener",
]);

const BULLET_RE = /^[ \t]*(?:[-*+•‣]|\d+[.)])[ \t]+\S/m;
const HEADING_RE = /^[ \t]*#{1,6}[ \t]+\S/m;
const BOLD_RE = /(\*\*|__)(?=\S)[\s\S]*?\S\1/;
const BACKTICK_RE = /`/;
// Em dash and en dash, plus the ASCII "--" people type for one. All three read as the
// same habit in a short reply and all three are trivially replaced with a full stop.
const DASH_RE = /[—–]|(?:^|\s)--(?:\s|$)/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);
const lower = (s) => String(s).toLowerCase();

/**
 * Split into sentences. Deliberately simple and PURE: a terminator followed by a space or
 * the end, plus hard line breaks, which people use as sentence breaks in a ticket. It
 * mis-splits "e.g." and "No. 4" — accepted, because the only consequence is one extra
 * counted sentence in a message that is capped at three anyway, and the alternative is an
 * abbreviation dictionary, which is a second corpus with no home.
 */
export const splitSentences = (text) => String(text == null ? "" : text)
  .split(/(?<=[.!?])[ \t]+|\r?\n+/)
  .map((s) => s.trim())
  .filter(Boolean);

/** True when `phrase` occurs in `haystack` on a word boundary (both already lower-case). */
const containsPhrase = (haystack, phrase) => {
  const i = haystack.indexOf(phrase);
  if (i < 0) return false;
  const before = i === 0 ? " " : haystack[i - 1];
  const after = i + phrase.length >= haystack.length ? " " : haystack[i + phrase.length];
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
};

/**
 * Lint one outward message.
 *
 * @param {string} text    the draft, ALREADY DEFANGED by the caller.
 * @param {object} voice   `{ register, maxSentences, language }` — the persona's voice
 *                         block from the normalised VA record. Unknown values fall back
 *                         to the table defaults, never to "no limit".
 * @param {object} [tables] the rule DATA (see voice-rules-data.js). Injected so the
 *                          `voice-rules` pack can replace the source in 14b.
 * @returns {{ok: boolean, blocks: Array<{rule:string, sentence?:number, phrase?:string, count?:number, limit?:number}>, warnings: Array<{rule:string, count?:number, limit?:number}>}}
 *
 * `sentence` is a 1-BASED INDEX, not the sentence. See the header: nothing the author
 * wrote comes back out of this function.
 */
export const lintVoice = (text, voice = {}, tables = VOICE_RULES_TABLES) => {
  const t = tables && typeof tables === "object" ? tables : VOICE_RULES_TABLES;
  const blocks = [];
  const warnings = [];
  const add = (rule, extra) => { blocks.push(extra ? { rule, ...extra } : { rule }); };

  const raw = typeof text === "string" ? text : "";
  const body = raw.trim();
  if (!body) {
    // An empty draft is a BLOCK, not a pass. "Nothing to check" must never read as
    // "checked and fine" — that is the proven-negative trap, and at this gate it would
    // let a staging bug post an empty comment.
    return { ok: false, blocks: [{ rule: "empty" }], warnings };
  }

  /* — structure: markdown and dashes, over the whole text — */
  if (BULLET_RE.test(raw)) add("markdown_bullet");
  if (HEADING_RE.test(raw)) add("markdown_heading");
  if (BOLD_RE.test(raw)) add("markdown_bold");
  if (BACKTICK_RE.test(raw)) add("markdown_backtick");
  if (DASH_RE.test(raw)) add("em_dash");

  const sentences = splitSentences(body);
  const lowered = lower(body);
  const loweredSentences = sentences.map(lower);

  /* — phrase tables. Each records WHICH table phrase matched (ours, not the author's). — */
  const phraseHit = (list, rule) => {
    for (const phrase of Array.isArray(list) ? list : []) {
      const p = lower(phrase);
      if (!p) continue;
      if (containsPhrase(lowered, p)) { add(rule, { phrase: p }); return; }
    }
  };
  phraseHit(t.aiDisclaimers, "ai_disclaimer");
  phraseHit(t.methodLeaks, "method_leak");

  // An opener is only an opener at the START of the first sentence.
  const first = loweredSentences[0] || "";
  for (const opener of Array.isArray(t.bannedOpeners) ? t.bannedOpeners : []) {
    const o = lower(opener);
    if (o && (first === o || first.startsWith(o + " ") || first.startsWith(o + ",") || first.startsWith(o + "!") || first.startsWith(o + "."))) {
      add("banned_opener", { sentence: 1, phrase: o });
      break;
    }
  }

  // A sign-off is a CLOSING: the last sentence, or a line of its own. The same words in
  // the middle of a sentence ("regards the invoice") are not a sign-off, which is why
  // this is anchored and the other tables are not.
  const lines = body.split(/\r?\n/).map((l) => lower(l).trim()).filter(Boolean);
  const lastSentence = loweredSentences[loweredSentences.length - 1] || "";
  for (const signOff of Array.isArray(t.signOffs) ? t.signOffs : []) {
    const s = lower(signOff);
    if (!s) continue;
    const asLine = lines.some((l) => l === s || l === s + "," || l === s + "." || l === s + "!" || l.startsWith(s + ","));
    const asClose = lastSentence === s || lastSentence === s + "." || lastSentence.startsWith(s + ",") || lastSentence.startsWith(s + " ");
    if (asLine || asClose) { add("sign_off", { sentence: loweredSentences.length, phrase: s }); break; }
  }

  /* — counts — */
  const maxSentences = Number.isInteger(voice && voice.maxSentences) && voice.maxSentences > 0
    ? voice.maxSentences
    : 3;
  if (sentences.length > maxSentences) add("over_max_sentences", { count: sentences.length, limit: maxSentences });

  const maxSentenceWords = Number(t.maxSentenceWords) || 45;
  const lengths = sentences.map((s) => words(s).length);
  lengths.forEach((n, idx) => { if (n > maxSentenceWords) add("long_sentence", { sentence: idx + 1, count: n, limit: maxSentenceWords }); });

  // BURSTINESS. Three or more sentences and not one of them short is the rhythm of
  // generated prose. It is a shape rule, so it is code; "vary your sentence length" in a
  // prompt is advice the model drops under pressure.
  const minSentences = Number(t.burstinessMinSentences) || 3;
  const shortWords = Number(t.burstinessShortWords) || 8;
  if (sentences.length >= minSentences && !lengths.some((n) => n <= shortWords)) {
    add("no_short_sentence", { count: sentences.length, limit: shortWords });
  }

  const caps = t.registerWordCaps && typeof t.registerWordCaps === "object" ? t.registerWordCaps : {};
  const register = voice && typeof voice.register === "string" && caps[voice.register] != null
    ? voice.register
    : (t.defaultRegister || "plain");
  const wordCap = Number(caps[register]);
  const total = words(body).length;
  if (Number.isFinite(wordCap) && wordCap > 0 && total > wordCap) {
    add("register_word_cap", { count: total, limit: wordCap });
  }

  /* — soft warnings: recorded on the item so a pattern is visible, never blocking — */
  const bangs = (body.match(/!/g) || []).length;
  const warnBangs = Number(t.warnExclamations);
  if (Number.isFinite(warnBangs) && bangs > warnBangs) warnings.push({ rule: "exclamations", count: bangs, limit: warnBangs });
  const questions = (body.match(/\?/g) || []).length;
  const warnQ = Number(t.warnQuestions);
  if (Number.isFinite(warnQ) && questions > warnQ) warnings.push({ rule: "question_pile", count: questions, limit: warnQ });
  if (EMOJI_RE.test(body)) warnings.push({ rule: "emoji" });
  if (sentences.length >= 2) {
    const firstWords = loweredSentences.map((s) => (s.match(/^[a-z']+/) || [""])[0]).filter(Boolean);
    if (firstWords.length >= 2 && new Set(firstWords).size < firstWords.length) warnings.push({ rule: "repeated_sentence_opener", count: firstWords.length - new Set(firstWords).size });
  }

  return { ok: blocks.length === 0, blocks, warnings };
};
