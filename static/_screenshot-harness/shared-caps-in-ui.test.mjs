/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * F-817 - A UI THAT RETYPES A SHARED CAP DISAGREES WITH IT IN SILENCE.
 *
 * F-816 found `meta.fieldGuide.slice(0, 12)` in FunctionBlock.jsx while
 * `GENERATION_META_LIMITS.maxFieldGuide` in `src/shared/registry-limits.js` carried the
 * comment "compactMeta already slices to 12 - same number, one home". The comment was the
 * defect: there were two homes, and the claim of one is what made the drift invisible.
 * F-816 removed that duplicate. It did not remove the MECHANISM - nothing stops the third
 * `slice(0, 12)` from appearing, and nothing goes red when the shared cap moves and the UI
 * does not. `registry-limits.js` is already imported across the bundle boundary by
 * `AgentConfig.jsx` and `JobsTab.jsx`, so the import was never what was missing.
 *
 * THE RULE THIS FILE ENFORCES
 *   A numeric literal in `static/{config-ui,admin-panel,config-view,issue-glance}/src`
 *   that (a) equals a numeric cap exported by `registry-limits.js` and (b) sits as a WHOLE
 *   ARGUMENT of `.slice(` / `.substring(` / `Math.min(` / `Math.max(`, or as the right
 *   operand of `.length >`/`<`/`>=`/`<=`, must either name the cap on the same statement
 *   (with the file importing the shared module) or carry an ALLOW-LIST entry here that
 *   says, in words, why the collision is a coincidence.
 *
 * WHY THE RULE IS SHAPED THAT WAY, AND WHAT IT DELIBERATELY DOES NOT SEE (all MEASURED on
 * the cohort at the time of writing - 99 source files, 39 hits):
 *
 *   - WHOLE ARGUMENT, not "somewhere in the statement". The loose form returned 291 hits,
 *     of which `Math.min(1000 * Math.pow(2, attempt), 8000)` and
 *     `Math.round((Date.now() - t) / 1000)` are typical: `1000` is a millisecond
 *     conversion that happens to equal `JOB_MAX_WRITES_PER_RUN`. A gate at that
 *     signal-to-noise gets switched off, which is worse than no gate.
 *   - ZERO IS NOT A CAP HERE. `JOB_MIN_WRITES_PER_RUN` is 0, and `slice(0, n)` puts a 0 in
 *     front of every trim in the codebase - 233 of the 291. A floor of zero cannot be told
 *     apart from the start index of a slice by any textual rule, so value 0 is skipped and
 *     said so rather than allow-listed 233 times.
 *   - NON-NEGATIVE LITERALS ONLY. `logs.slice(-20)` means "the last 20", a tail length that
 *     is never one of these caps today. A future cap written as a tail slice is a BLIND
 *     SPOT of this test, stated rather than papered over.
 *   - FRACTIONS ARE OUT OF REACH. `REGISTRY_WARN_AT` (0.7) / `REGISTRY_FULL_AT` (0.9) are
 *     ratios, never slice or length arguments; the literal pattern is integers only.
 *   - The scan reads CODE, not comments: `maskComments` from
 *     `test-harness/lib/js-source-scan.mjs` is the one home for "which bytes are a
 *     comment", and a docblock that quotes "slices to 12" is prose about the rule, not a
 *     second copy of it.
 *
 * A source scan, not a browser test, for the same reason refusal-contract.test.mjs is one:
 * both builds render. The wrong number is only wrong later, in someone else's storage.
 *
 * Run: node shared-caps-in-ui.test.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { maskComments } from "../../test-harness/lib/js-source-scan.mjs";
import * as LIMITS from "../../src/shared/registry-limits.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };

/* ---------------------------------------------------------------------------
 * 1. EVERY NUMERIC CAP THE SHARED MODULE EXPORTS
 *
 * Enumerated from the live module rather than listed here, so a cap added tomorrow is
 * covered without anyone remembering this file - which is the whole complaint of F-817.
 * Frozen objects (GENERATION_META_LIMITS, KNOWLEDGE_BUDGET_BYTES, FIELD_GUIDE_BUDGET_BYTES)
 * are walked two levels deep, which is as deep as they go.
 * ------------------------------------------------------------------------- */
const CAPS = new Map();           // value -> [names]
const addCap = (name, v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return;
  if (v === 0) return;            // see the docblock: 0 is `slice(0, n)`, not a cap
  if (!CAPS.has(v)) CAPS.set(v, []);
  CAPS.get(v).push(name);
};
for (const [k, v] of Object.entries(LIMITS)) {
  if (typeof v === "number") addCap(k, v);
  else if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k2, v2] of Object.entries(v)) {
      if (typeof v2 === "number") addCap(`${k}.${k2}`, v2);
      else if (v2 && typeof v2 === "object" && !Array.isArray(v2)) {
        for (const [k3, v3] of Object.entries(v2)) addCap(`${k}.${k2}.${k3}`, v3);
      }
    }
  }
}
/* The names a statement may cite to claim a literal. `GENERATION_META_LIMITS.maxFieldGuide`
   is cited as either the whole path or the leaf, because `const L = GENERATION_META_LIMITS`
   then `L.maxFieldGuide` is the idiom normalizeGenerationMeta itself uses. */
const citations = (names) => {
  const out = new Set();
  for (const n of names) { out.add(n); for (const part of n.split(".")) out.add(part); }
  return [...out];
};

ok(CAPS.size > 0, `registry-limits.js exports ${CAPS.size} distinct non-zero numeric cap values`);
ok(CAPS.has(12) && CAPS.get(12).includes("GENERATION_META_LIMITS.maxFieldGuide"),
  "the F-816 cap (maxFieldGuide = 12) is in the enumerated set");

/* ---------------------------------------------------------------------------
 * 2. THE ALLOW-LIST - coincidences, each with the reason quoted.
 *
 * `file` is a path SUFFIX, so one entry covers the byte-identical config-ui/admin-panel
 * copies of a component (and the deliberately diverged CustomSelect triplet). `match` is a
 * substring of the source LINE, so an entry survives the line moving but not the code
 * changing. Every entry must match at least one live hit (section 4) - a stale exemption is
 * an exemption nobody reviewed.
 * ------------------------------------------------------------------------- */
const ALLOW = [
  { file: "components/CustomSelect.jsx", value: 10, match: "normalized.length >= 10",
    why: "the dropdown grows a search box past ten options - a layout threshold, unrelated to VA_HISTORY_MAX / WEB_SEARCH_MAX_PER_RUN" },
  { file: "components/DocRepository.jsx", value: 200000, match: "(too large)",
    why: "the ~200 KB Documentation Library content cap enforced by saveContextDoc (src/index.js), which coincides with REGISTRY_CREATE_MAX_BYTES but is a different rule - it has its own duplication problem, filed separately" },
  { file: "components/DocRepository.jsx", value: 200000, match: "disabled={saving ||",
    why: "the same doc-size cap on the Save button's disabled predicate; see the entry above" },
  { file: "components/FunctionBlock.jsx", value: 100, match: "const header = ",
    why: "the first 100 characters of the prompt echoed as a comment at the top of generated code - display text, not GENERATION_META_LIMITS.maxIdChars" },
  { file: "components/FunctionBlock.jsx", value: 60, match: "Step {i + 1}",
    why: "a 60-character preview of the step prompt in the step header - display text, not maxRecipeParamKeyChars" },
  { file: "components/FunctionBlock.jsx", value: 60, match: "name: functionData.name ||",
    why: "a default step NAME derived from the prompt's first 60 characters - a name, not a recipe param key" },
  { file: "components/FunctionBlock.jsx", value: 10, match: "if (!text || text.length < 10) return;",
    why: "too short to be worth distilling into a memory - a minimum, and the caps here are maxima" },
  { file: "components/MemoriesTab.jsx", value: 5, match: ".slice(0, 5)",
    why: "the five most recent memories shown in the summary strip - a display count, not VA_MAX_ITEMS_PER_TICK_DEFAULT" },
  { file: "components/PremadeRuleForm.jsx", value: 120, match: "config.spaceKey = spaceKey.trim().slice(0, 120)",
    why: "a Confluence space key bound; coincides with maxRecipeKeyChars but bounds a different string" },
  { file: "components/PremadeRuleForm.jsx", value: 5, match: "nlText.trim().length < 5",
    why: "fewer than five characters is not a describable rule - a minimum, and the caps here are maxima" },
  { file: "components/editor/sandboxCompletions.js", value: 3, match: "text.length < 3",
    why: "under three typed characters the completion list is not filtered - an editor affordance" },
  { file: "components/JobsTab.jsx", value: 6, match: "Math.random().toString(36).slice(2, 6)",
    why: "six random base-36 characters of a step id - an id suffix, not VA_CAPS_PER_HOUR_DEFAULT" },
  { file: "components/ListenersTab.jsx", value: 6, match: "Math.random().toString(36).slice(2, 6)",
    why: "the same id-suffix idiom as JobsTab" },
  { file: "components/JobsTab.jsx", value: 100, match: "Max issues",
    why: "the per-run issue-scope ceiling of a scheduled job, owned by the job scope schema, not by maxIdChars" },
  { file: "components/ListenersTab.jsx", value: 3, match: "evs.slice(0, 3)",
    why: "three event chips shown before the +N more pill - a display count" },
  { file: "components/ListenersTab.jsx", value: 3, match: "evs.length > 3 &&",
    why: "the +N pill's threshold, the pair of the entry above" },
  { file: "components/OpenAIConfig.jsx", value: 100, match: "const enginePct =",
    why: "a percentage clamped to 0..100 - a unit, not a cap" },
  { file: "components/OpenAIConfig.jsx", value: 100, match: "const allowancePct =",
    why: "a percentage clamped to 0..100 - a unit, not a cap" },
  { file: "admin-panel/src/App.js", value: 100, match: "reg-meter-fill",
    why: "the registry meter's width as a percentage, clamped to 0..100 - a unit, not a cap" },
  { file: "admin-panel/src/App.js", value: 200, match: "discovered.slice(0, 200)",
    why: "at most 200 discovered workflow rows rendered in the import picker - a render bound chosen for the DOM, not MAX_MEMORIES / maxTitleChars" },
  { file: "admin-panel/src/App.js", value: 200, match: "discovered.length > 200 &&",
    why: "the 'showing first 200' notice, the pair of the entry above" },
  { file: "config-view/src/App.js", value: 100, match: "config.prompt.length > 100",
    why: "the read-only summary truncates a long prompt for display at 100 characters" },
  { file: "config-view/src/App.js", value: 100, match: "config.prompt.substring(0, 100)",
    why: "the truncation itself, the pair of the entry above" },
];

/* ---------------------------------------------------------------------------
 * 3. THE SCANNER - one function, used by both the live scan and the controls.
 * ------------------------------------------------------------------------- */
const MARKERS = /(?:\.(?:slice|substring)|Math\.(?:min|max))\s*\(/g;

/** Top-level argument spans of the call whose "(" sits at `openIdx`. */
function callArgSpans(code, openIdx) {
  let depth = 0, start = openIdx + 1;
  const out = [];
  for (let i = openIdx; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) { out.push([start, i]); return out; } }
    else if (c === "," && depth === 1) { out.push([start, i]); start = i + 1; }
  }
  return null;                     // unbalanced (masked JSX edge) - report nothing
}

/**
 * @returns {{value:number, names:string[], how:string, line:number, text:string}[]}
 */
function scanSource(src) {
  const code = maskComments(src);
  const raw = [];
  for (const m of code.matchAll(MARKERS)) {
    const spans = callArgSpans(code, m.index + m[0].length - 1);
    if (!spans) continue;
    for (const [s, e] of spans) {
      const t = code.slice(s, e).trim();
      if (/^\d+$/.test(t)) raw.push([s, Number(t), m[0].trim()]);
    }
  }
  for (const m of code.matchAll(/\.length\s*(>=|<=|>|<)\s*(\d+)(?![\w.])/g)) {
    raw.push([m.index, Number(m[2]), ".length " + m[1]]);
  }
  const lines = src.split("\n");
  const out = [];
  for (const [idx, value, how] of raw) {
    if (!CAPS.has(value)) continue;
    const line = code.slice(0, idx).split("\n").length;
    out.push({ value, names: CAPS.get(value), how, line, text: lines[line - 1] });
  }
  return out.sort((a, b) => a.line - b.line);
}

/* ---------------------------------------------------------------------------
 * 4. CONTROLS - the scanner is only evidence if it is known to fire and known to stay quiet.
 * ------------------------------------------------------------------------- */
/* POSITIVE: the exact line F-816 removed from FunctionBlock.jsx. */
const PRE_F816 = `
const compactMeta = (meta) => ({
  fieldGuide: (meta.fieldGuide || []).slice(0, 12).map((s) => s.id),
});
`;
const posHits = scanSource(PRE_F816);
ok(posHits.some((h) => h.value === 12 && h.names.includes("GENERATION_META_LIMITS.maxFieldGuide")),
  "positive control: the pre-F-816 `slice(0, 12)` is flagged against maxFieldGuide");

/* NEGATIVE: the F-816 shape. 40 is this editor's own write-compaction, declared as a named
   constant and bounded by Math.min against the shared ceiling - a relationship, not a copy. */
const POST_F816 = `
const EDITOR_TITLE_CHARS = 40;
const TITLE_CHARS = Math.min(EDITOR_TITLE_CHARS, GENERATION_META_LIMITS.maxTitleChars);
const sliceTitle = (t) => (t || "").slice(0, TITLE_CHARS);
const fieldGuide = (meta.fieldGuide || []).slice(0, GENERATION_META_LIMITS.maxFieldGuide);
`;
ok(scanSource(POST_F816).length === 0,
  "negative control: EDITOR_TITLE_CHARS = 40 bounded by Math.min raises nothing");

/* A comment that QUOTES the old number is prose, not a second home. */
ok(scanSource("// compactMeta already slices to 12 - same number, one home\nconst x = 1;\n").length === 0,
  "negative control: a docblock quoting `slices to 12` is masked, not scanned");

/* ---------------------------------------------------------------------------
 * 5. THE LIVE SCAN
 * ------------------------------------------------------------------------- */
const APPS = ["config-ui", "admin-panel", "config-view", "issue-glance"];
const sources = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|jsx)$/.test(name)) sources.push(full);
  }
};
for (const app of APPS) walk(join(REPO, "static", app, "src"));
ok(sources.length > 50, `scanned ${sources.length} source files across ${APPS.length} apps`);

const used = new Set();
const offences = [];
for (const file of sources) {
  const rel = relative(join(REPO, "static"), file).split(sep).join("/");
  const src = readFileSync(file, "utf8");
  const importsShared = /from\s+["'][^"']*registry-limits(\.js)?["']/.test(maskComments(src));
  for (const hit of scanSource(src)) {
    /* Named on the statement AND imported from the shared module - the intended shape. */
    const cited = citations(hit.names).some((n) => new RegExp(`\\b${n}\\b`).test(hit.text));
    if (cited && importsShared) continue;
    const idx = ALLOW.findIndex((a) => rel.endsWith(a.file) && a.value === hit.value && hit.text.includes(a.match));
    if (idx >= 0) { used.add(idx); continue; }
    offences.push(`${rel}:${hit.line}  ${hit.value} via ${hit.how} looks like ${hit.names.join(" | ")}\n      ${hit.text.trim().slice(0, 140)}`);
  }
}
ok(offences.length === 0, offences.length === 0
  ? "no UI file retypes a registry-limits cap next to a slice/substring/length bound"
  : `${offences.length} UI literal(s) equal a shared cap with no import, no name and no allow-list entry:\n    ` + offences.join("\n    "));

const stale = ALLOW.map((a, i) => (used.has(i) ? null : `${a.file} ${a.value} "${a.match}"`)).filter(Boolean);
ok(stale.length === 0, stale.length === 0
  ? `all ${ALLOW.length} allow-list entries still match a live line`
  : `stale allow-list entries (the code moved on; re-read the reason before deleting):\n    ` + stale.join("\n    "));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} - ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
