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
 * @returns {string} a string of exactly `src.length` characters.
 */
export function maskNonCode(src) {
  const out = src.split("");
  const blank = (a, b) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== "\n") out[k] = " "; };

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
     kept verbatim because it is the one that was paid for. */
  const regexCanStart = () => {
    const last = lastCode();
    if (!last) return true;
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
      if (c === "\\") { blank(i, i + 2); i += 2; continue; }
      if (two === "${") { blank(i, i + 2); i += 2; mode = "code"; holes.push(0); continue; }
      if (c === "`") { blank(i, i + 1); i += 1; mode = resume.pop() || "code"; continue; }
      blank(i, i + 1); i += 1; continue;
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
    if (c === "/" && regexCanStart()) {
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
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        /* A quoted literal cannot span a newline. Stopping there bounds the damage an
           UNTERMINATED quote can do to everything after it. */
        if (src[j] === "\n") break;
        if (src[j] === c) { j += 1; break; }
        j += 1;
      }
      blank(i, j); i = j; continue;
    }
    if (c === "`") { blank(i, i + 1); i += 1; resume.push("code"); mode = "tmpl"; continue; }

    if (holes.length) {
      if (c === "{") holes[holes.length - 1] += 1;
      else if (c === "}") {
        if (holes[holes.length - 1] === 0) { holes.pop(); blank(i, i + 1); i += 1; mode = "tmpl"; continue; }
        holes[holes.length - 1] -= 1;
      }
    }
    i += 1;
  }
  return out.join("");
}

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
