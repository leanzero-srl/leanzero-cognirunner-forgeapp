/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * "WHICH BYTES OF THIS FILE ARE CODE?" — ONE HOME. F-716, F-728, F-730.
 *
 * Two offline suites read every live driver as TEXT, and both of them have to answer the
 * same question before they can answer their own: a name inside a string is not a use, and a
 * parenthesis inside a FAIL message is not a paren. Each grew its own answer.
 *
 *   · `scripts/live-driver-scope.test.mjs` had `stripNonCode` — comments, strings, templates
 *     (holes preserved, because an interpolated identifier IS a read) and regex literals,
 *     with a `regexCanStart` heuristic paid for in false positives: `/WRITE BRAKE/`,
 *     `/cache|DEFECT/i` and `/ROTATION NOT/` were read as three module-scope constants.
 *   · `scripts/evidence-redaction.test.mjs` had `stripComments` and NOTHING ELSE, and then
 *     walked parentheses over the result (F-716's `callArgs`). F-730: an unmatched `)` in a
 *     FAIL message truncates that call's own argument list and drops the `paths:` that is
 *     really there — MEASURED, `leakFailNamesArtefacts('FAIL("a capture was REFUSED :) the
 *     mask failed", { paths: … });')` returned FALSE, red on a driver that is right — and an
 *     unmatched `(` either returns null or swallows forward past the call, which is the
 *     unbounded window F-716 was cut to remove, re-entered.
 *
 * So it is here, once, and it MASKS rather than strips: the answer is the SAME LENGTH as the
 * input, so a caller can balance brackets on the mask and slice the ORIGINAL by the same
 * indices. That is what lets `callArgs` read a FAIL's real message — which is where `REFUSED`
 * lives — while counting only the parens that are code.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Comments, string bodies, template TEXT and regex literals replaced by spaces; newlines,
 * and therefore line numbers, preserved; `${…}` substitution holes KEPT AS CODE, recursively.
 *
 * @param {string} src
 * @param {{keepLiterals?: boolean}} [opts] — see `maskComments` below.
 * @returns {string} a string of exactly `src.length` characters.
 */
export function maskNonCode(src, opts) {
  /* F-769 — THE ONE PLACE THAT KNOWS WHERE A COMMENT ENDS, ASKED A SECOND WAY.
   *
   * Every caller so far wanted "a name in a string is not a use", so masking literals was
   * the whole point. The credential rule (section 4i of evidence-redaction.test.mjs) wants
   * the OPPOSITE half: `COGNIRUNNER_KEY_` inside `` `COGNIRUNNER_KEY_${provider}` `` IS the
   * thing it is looking for, while the same words in a docblock explaining the read ceiling
   * are prose — and several drivers in this directory carry exactly that prose.
   *
   * That is one question ("which bytes are a comment?") with two consumers, which is the
   * defect this module was cut for. So it is an OPTION on the same walk rather than a
   * second scanner: the mode machinery, the regex heuristic and the F-754 unterminated-quote
   * behaviour are shared byte for byte, and only the blanking is conditional. */
  const keepLiterals = !!(opts && opts.keepLiterals);
  const out = src.split("");
  const blank = (a, b) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== "\n") out[k] = " "; };
  /** Blank a LITERAL span — a no-op when the caller asked to keep literals. */
  const blankLit = (a, b) => { if (!keepLiterals) blank(a, b); };

  /* The last character already emitted that is not whitespace. Masked bytes are spaces, so a
     string or a comment is correctly invisible to the question below. */
  const lastCode = () => {
    for (let k = i - 1; k >= 0; k--) {
      const ch = out[k];
      if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") continue;
      return { ch, k };
    }
    return null;
  };
  /* A `/` starts a REGEX LITERAL only where a VALUE is expected. Every false positive in the
     first run of the scope suite came from getting this wrong; the heuristic is that suite's,
     kept because it is the one that was paid for — with ONE correction (F-754).

     F-754: `+` and `-` are in the operator list because `a = b + /re/.test(c)` expects a value
     after them, but the list cannot see the difference between the BINARY `+` and the second
     `+` of a POSTFIX `++`, which yields a value and is therefore followed by DIVISION.
     MEASURED on `const r = a++ / b + c / d;`: ` b + c ` was masked as a regex body, hiding any
     identifier between the two divisions from the RULE 2 unbound-name scan. A `++`/`--`
     digraph is the only place this bites, so it is the only thing excluded — in particular
     `>` STAYS, because `=> /cache|DEFECT/i.test(v)` is the shape 174 sites in this directory
     are written in, and reading those regex bodies as code is the original false positive.

     The prescribed-by-ledger alternative (drop every operator but `( , = : [ ! & | ? { } ;`)
     would have taken `>` with it and re-opened exactly that. */
  const regexCanStart = () => {
    const last = lastCode();
    if (!last) return true;
    if ((last.ch === "+" || last.ch === "-") && out[last.k - 1] === last.ch) return false;
    if ("(,=:[!&|?{};+-*%~^<>".includes(last.ch)) return true;
    if (/[\w$)\]]/.test(last.ch)) {
      /* `return /x/`, `typeof /x/` — a keyword, not a value. */
      const tail = out.slice(Math.max(0, last.k - 12), last.k + 1).join("");
      return /\b(return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/.test(tail);
    }
    return false;
  };

  let i = 0;
  let mode = "code";          // "code" | "tmpl"
  const resume = [];          // what a closing backtick returns to
  const holes = [];           // brace depth inside each open `${…}`, innermost last

  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);

    if (mode === "tmpl") {
      if (c === "\\") { blankLit(i, i + 2); i += 2; continue; }
      if (two === "${") { blankLit(i, i + 2); i += 2; mode = "code"; holes.push(0); continue; }
      if (c === "`") { blankLit(i, i + 1); i += 1; mode = resume.pop() || "code"; continue; }
      blankLit(i, i + 1); i += 1; continue;
    }

    if (two === "//") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop); i = stop; continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop); i = stop; continue;
    }
    /* A REGEX IS NOT SCANNED FOR WHEN LITERALS ARE KEPT. `regexCanStart` reads the bytes
       already emitted, and in this mode string bodies are still there — so it would be
       answering a different question from the one it was tuned on, and a wrong YES SKIPS
       `i` forward, which could step over the very text the caller is searching for. Not
       opening a regex can only leave MORE visible, which for this mode's one consumer is
       the direction that refuses rather than the one that passes. */
    if (!keepLiterals && c === "/" && regexCanStart()) {
      let j = i + 1, cls = false, closed = false;
      while (j < src.length) {
        const d = src[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;                       /* not a regex after all */
        if (d === "[") cls = true;
        else if (d === "]") cls = false;
        else if (d === "/" && !cls) { j += 1; closed = true; break; }
        j += 1;
      }
      if (closed) {
        while (j < src.length && /[dgimsuvy]/.test(src[j])) j += 1;
        blank(i, j); i = j; continue;
      }
    }
    if (c === '"' || c === "'") {
      let j = i + 1, closed = false;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        /* A quoted literal cannot span a newline. Stopping there bounds the damage an
           UNTERMINATED quote can do to everything after it. */
        if (src[j] === "\n") break;
        if (src[j] === c) { j += 1; closed = true; break; }
        j += 1;
      }
      /* F-754: an UNCLOSED quote is not a string, so it masks NOTHING. In valid JS a quote
         always closes on its own line, so the only way to reach here is that this `'` was
         never a quote at all — an apostrophe inside a regex body the heuristic above declined
         to open (`f(x) /don't/.test(s)`: `/` after `)` is division, so `don` is code and the
         apostrophe is bare). Masking to end-of-line there swallowed the REST OF THE LINE:
         MEASURED, `callArgs("const t = f(x) /don't/.test(s); … FAIL(\"m\", { paths: [1] });",
         "FAIL")` returned `[]` and the leak rule read zero FAIL calls for the file — the
         FAIL-OPEN direction F-730 was cut to close. Masking nothing can only ADD visible
         code, which for every caller here is the direction that refuses rather than passes.
         `i` still advances past the quote, so the walk always terminates. */
      if (closed) { blankLit(i, j); i = j; continue; }
      i += 1; continue;
    }
    if (c === "`") { blankLit(i, i + 1); i += 1; resume.push("code"); mode = "tmpl"; continue; }

    if (holes.length) {
      if (c === "{") holes[holes.length - 1] += 1;
      else if (c === "}") {
        if (holes[holes.length - 1] === 0) { holes.pop(); blankLit(i, i + 1); i += 1; mode = "tmpl"; continue; }
        holes[holes.length - 1] -= 1;
      }
    }
    i += 1;
  }
  return out.join("");
}

/**
 * COMMENTS ONLY, replaced by spaces. Strings, template TEXT and regex bodies are KEPT.
 *
 * The other half of the same question, for the caller that needs a KEY LITERAL to survive:
 * `COGNIRUNNER_KEY_` lives inside `` `COGNIRUNNER_KEY_${provider}` ``, which `maskNonCode`
 * masks away by design, while the identical words in a docblock ABOUT the read ceiling are
 * prose that must not count as a use — and this directory is full of that prose.
 *
 * It cannot tell a `//` inside a string from a comment by looking at two characters, which
 * is exactly why it is this walk with an option and not a regex: the quote and template
 * tracking is what makes `"http://x"` not a comment.
 *
 * @param {string} src
 * @returns {string} a string of exactly `src.length` characters.
 */
export const maskComments = (src) => maskNonCode(src, { keepLiterals: true });

/**
 * THE ARGUMENT TEXT OF EVERY CALL TO `name`, PAREN-BALANCED OVER CODE ONLY (F-716, F-730).
 *
 * The balance is walked on the MASK and the slice is taken from the ORIGINAL, so a FAIL whose
 * message contains `:)` — or `(GET → 200)`, or `(src/harness-fault.js)`, all of which this
 * directory's messages really carry — is read correctly AND its text survives for the caller
 * to match against. The call NAME is matched on the mask too, so `"call FAIL("` written
 * inside a string is not a call site.
 *
 * A call whose parens cannot be closed is `null`, never an empty match: every caller treats
 * `null` as a FAILURE, which is the direction a directory rule may be wrong in.
 *
 * @returns {(string|null)[]} one entry per call, in source order.
 */
export function callArgs(code, name) {
  const masked = maskNonCode(code);
  const out = [];
  for (const m of masked.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))) {
    const open = m.index + m[0].length - 1;
    let depth = 0, end = -1;
    for (let j = open; j < masked.length; j++) {
      if (masked[j] === "(") depth += 1;
      else if (masked[j] === ")") { depth -= 1; if (depth === 0) { end = j; break; } }
    }
    out.push(end < 0 ? null : code.slice(open + 1, end));
  }
  return out;
}

/**
 * The brace-balanced value of `key:` inside an argument list, or `null` if it is not an
 * object. Same rule as `callArgs`: braces are counted on the mask, the text comes from the
 * original — a `}` inside a message is not a closing brace.
 */
export function objectValue(args, key) {
  if (!args) return null;
  const masked = maskNonCode(args);
  const m = masked.match(new RegExp(`\\b${key}\\s*:\\s*\\{`));
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let j = open; j < masked.length; j++) {
    if (masked[j] === "{") depth += 1;
    else if (masked[j] === "}") { depth -= 1; if (depth === 0) return args.slice(open, j + 1); }
  }
  return null;
}
