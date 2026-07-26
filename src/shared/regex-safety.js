/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ReDoS (catastrophic-backtracking) risk check for user/AI-supplied regex patterns.
 *
 * The premade "Field matches a pattern" validator runs an admin-supplied RegExp against
 * reporter-controlled field values (a Description is ~32KB) with NO timeout. A nested
 * unbounded quantifier such as `^(a+)+$` backtracks in O(2^n) and blows past Forge's 25s
 * sync-validator budget on a few dozen input chars — a reporter-triggerable DoS on the gate.
 * JS regexes are synchronous and can't be interrupted, so the defense is to REJECT the
 * dangerous shape (at config-save) and REFUSE to run it (at runtime, fail-open).
 *
 * `redosRisk(pattern)` returns a human reason STRING when the pattern has the classic
 * catastrophic shape — an UNBOUNDED quantifier (`*`, `+`, `{n,}`) applied to a group whose
 * body ALSO contains an unbounded quantifier (`(a+)+`, `(\w+\s?)+`, `(x+x+)+y`, `([a-z]+)*`,
 * `(a{2,})+`, …) — else null. Conservative + dependency-free (bundles into backend + both
 * frontends). It intentionally does NOT try to catch overlapping-alternation ReDoS
 * (`(a|a)+`) — rarer, and static detection there is unreliable; the runtime length cap is
 * the backstop for shapes this misses.
 */

/** True if the char at s[idx] starts an UNBOUNDED quantifier: `*`, `+`, or `{n,}` (no upper bound). */
function unboundedQuantAt(s, idx) {
  const c = s[idx];
  if (c === "*" || c === "+") return true;
  if (c === "{") {
    const close = s.indexOf("}", idx);
    if (close === -1) return false;
    const body = s.slice(idx + 1, close);
    // unbounded iff a comma is present with no upper bound: {n,} or {,}
    const m = body.match(/^\s*\d*\s*,\s*(\d*)\s*$/);
    return !!(m && m[1] === "");
  }
  return false;
}

/**
 * @param {string} pattern a regular-expression source string
 * @returns {string|null} a reason if the pattern risks catastrophic backtracking, else null
 */
export function redosRisk(pattern) {
  const s = String(pattern == null ? "" : pattern);
  if (!s) return null;
  const REASON =
    "This pattern has nested unbounded repetition (e.g. (a+)+ ) that can cause catastrophic backtracking and hang the transition for everyone. Simplify it — bound a repetition (e.g. {1,50}), or remove one level of nesting.";
  const stack = []; // per open group: { hasUnbounded }
  let inClass = false; // inside a [...] character class
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; } // skip the escaped char
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c === "(") { stack.push({ hasUnbounded: false }); continue; }
    if (c === ")") {
      const grp = stack.pop() || { hasUnbounded: false };
      const quantAfter = unboundedQuantAt(s, i + 1);
      // RISK: this group is unbounded-quantified AND its body already had an unbounded quantifier.
      if (quantAfter && grp.hasUnbounded) return REASON;
      // A quantified group behaves like an unbounded repetition inside its PARENT's body.
      if (quantAfter && stack.length) stack[stack.length - 1].hasUnbounded = true;
      continue;
    }
    // a bare unbounded quantifier contributes to the CURRENT group's body
    if ((c === "*" || c === "+" || c === "{") && unboundedQuantAt(s, i) && stack.length) {
      stack[stack.length - 1].hasUnbounded = true;
    }
  }
  return null;
}
