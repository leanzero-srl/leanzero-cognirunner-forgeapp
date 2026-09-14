/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-704 — THE GATED-EXPORT CONTRACT, IN ONE PLACE, ASKED BY BOTH SUITES.
 *
 * `HARNESS_GATED_EXPORTS` (F-694) was never cross-checked against the module's REAL export
 * set. The only completeness assertion compared the count of `if (!harnessEnabled())` lines
 * to the list's length — both sides of which are the gated set — so an export added with
 * NEITHER the gate line NOR a list entry left 9 === 9 and was never visited by the per-name
 * loop. A storage-touching export shipped reachable with no HARNESS_SECRET, which is the one
 * thing the gate exists to prevent.
 *
 * So the check is now against `Object.keys(module)`: the module's three lists must PARTITION
 * it — cover every name, claim no name twice, and name nothing that is not an export. Plus
 * the per-class source rules that make each list mean what it says.
 *
 * THIS IS A PURE FUNCTION RETURNING VIOLATIONS, deliberately: that is what lets each suite
 * feed it a FAKE extra export and assert that the contract FAILS, which is the only way to
 * know the assertion can go red. A helper that called `ok()` itself could not be negatively
 * controlled without faking the harness.
 */

/** Comments are not code: a `storage.` inside a docblock must not count as a storage call. */
export const stripJsComments = (src) =>
  String(src).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/*
 * The SOURCE of each top-level export, bounded by the next TOP-LEVEL declaration of ANY
 * kind — not by the next `export`. `setFaultRow`/`getFaultRow`/`sweepPause` are private
 * consts sitting between two exports, and slicing export-to-export would attribute their
 * `storage.set` to whichever pure predicate happens to precede them.
 */
const TOP_LEVEL = /^(?:export\s+)?(?:const|let|var|class|function|async\s+function)\s+/gm;
const EXPORT_DECL = /^export\s+(?:const|class|function|async\s+function)\s+([A-Za-z0-9_$]+)/gm;

export const exportSources = (src) => {
  const code = stripJsComments(src);
  const starts = [...code.matchAll(TOP_LEVEL)].map((m) => m.index);
  const out = new Map();
  for (const m of code.matchAll(EXPORT_DECL)) {
    const at = m.index;
    const end = starts.find((i) => i > at);
    out.set(m[1], code.slice(at, end === undefined ? code.length : end));
  }
  return out;
};

/**
 * Every way the three lists can be wrong, as sentences. Empty array === the contract holds.
 *
 * `names` is passed in rather than read from the module so a suite can hand over an
 * augmented set (the negative control) without importing a doctored module.
 */
export const gatedExportViolations = ({ names, src, gated, inherited, ungated }) => {
  const problems = [];
  const sources = exportSources(src);
  const all = new Set(names);
  const claimed = [...gated, ...inherited, ...ungated];
  const claimedSet = new Set(claimed);

  if (claimed.length !== claimedSet.size) {
    const seen = new Set(), dup = new Set();
    for (const n of claimed) { if (seen.has(n)) dup.add(n); seen.add(n); }
    problems.push(`a name is on TWO of the three lists — pick one: ${[...dup].join(", ")}`);
  }
  for (const n of all) {
    if (!claimedSet.has(n)) {
      problems.push(`export \`${n}\` is on NONE of HARNESS_GATED_EXPORTS / HARNESS_INHERITED_GATE_EXPORTS / HARNESS_UNGATED_EXPORTS — an unclassified export is exactly the ungated KVS reader F-704 is about`);
    }
  }
  for (const n of claimedSet) {
    if (!all.has(n)) problems.push(`\`${n}\` is listed but is not an export of the module`);
  }

  for (const n of gated) {
    const body = sources.get(n);
    if (body === undefined) { problems.push(`gated \`${n}\` has no top-level export declaration to read`); continue; }
    if (!/^export\s+const\s+[A-Za-z0-9_$]+\s*=\s*async\s*\([^)]*\)\s*=>\s*\{\s*if \(!harnessEnabled\(\)\)/.test(body)) {
      problems.push(`the gate is NOT the first statement of gated export \`${n}\``);
    }
  }
  for (const n of [...inherited, ...ungated]) {
    const body = sources.get(n);
    if (body === undefined) { problems.push(`\`${n}\` has no top-level export declaration to read`); continue; }
    if (/\bstorage\./.test(body)) {
      problems.push(`\`${n}\` is listed as not-directly-gated but names \`storage.\` in its own body — it must carry the gate and join HARNESS_GATED_EXPORTS`);
    }
  }
  return problems;
};
