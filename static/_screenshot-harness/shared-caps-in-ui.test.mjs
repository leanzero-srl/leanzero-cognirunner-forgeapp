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
 *   F-855 adds a SECOND cohort with a stricter form: the CAP GUARD SOURCES in section 6,
 *   offline suites whose job is to guard these caps. There, a bare `const NAME = <literal>`
 *   counts too, because a guard's second home does not need to sit in a slice to do harm:
 *   `const DOC_CONTENT_MAX = 200000` compared the seeds against the guard's own copy of a
 *   cap that had already moved unit (F-836 made it BYTES), and stayed green either way.
 *   The declaration form is deliberately OFF for UI files, where `const PAGE_SIZE = 25`
 *   beside an unrelated cap of 25 is a coincidence by the hundred.
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
 * @param {string} src
 * @param {{declarations?:boolean}} [opts]  `declarations` adds the `const NAME = <literal>`
 *        form (F-855). See the note inside; it is for CAP GUARD SOURCES, not for UI files.
 * @returns {{value:number, names:string[], how:string, line:number, text:string}[]}
 */
function scanSource(src, { declarations = false } = {}) {
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
  /* F-855 - THE DECLARATION FORM, for CAP GUARD SOURCES only (see section 6).
     `const DOC_CONTENT_MAX = 200000;` is the shape the doc cap was retyped in, and none
     of the patterns above can see it: it is not a slice argument and not a length bound,
     it is a SECOND HOME with a name of its own, compared against later by that name. It
     is off by default because a UI file declaring `const PAGE_SIZE = 25` next to an
     unrelated cap of 25 is a coincidence by the hundred; in a file whose whole job is to
     guard these caps it is the defect itself. */
  if (declarations) {
    /* `,\s*` catches the SECOND declarator of `const A = 100, B = 200000;` - which is the
       exact shape the doc cap was retyped in, so a rule that only understood the first
       one would have missed the defect it was written for. */
    for (const m of code.matchAll(/(?:\b(?:const|let|var)\s+|,\s*)([A-Za-z_$][\w$]*)\s*=\s*(\d+)(?![\w.])/g)) {
      raw.push([m.index, Number(m[2]), `${m[1]} = <literal>`]);
    }
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

/* ===========================================================================
 * 6. F-853 - NO UI FILE MAY TYPE A ROSTER ROLE/SCOPE **DEFAULT** LITERAL
 *
 * THE DEFECT THIS ARM EXISTS TO KILL. F-840 found the product's READ of an `app_admins`
 * row defaulting a scope-less editor to `"all"` - site-wide reach - while both WRITE
 * paths clamped the same silence to `"own"`. F-843 found the third copy: the admin
 * panel's roster card carried its own private `user.scope || "all"` and therefore
 * PRINTED a wider scope than the backend enforced. F-844 pulled the vocabulary itself
 * (`VALID_ROLES` / `VALID_SCOPES`) into `src/shared/roster-roles.js`. Three findings, one
 * mechanism: a default typed as a literal at the place that happens to need it.
 *
 * Each of those was fixed by hand. NOTHING stopped the fourth copy - and a wrong roster
 * default is not a cosmetic drift: it is a permission the product grants, or displays as
 * granted, that nobody ever gave.
 *
 * THE RULE
 *   No file under `static/{config-ui,admin-panel,config-view,issue-glance}/src` may write
 *   a roster-vocabulary literal ("own"/"all"/"viewer"/"editor"/"admin") as the DEFAULT of
 *   a binding whose name is about a role or a scope. The three shapes that count:
 *     A. `<something>.scope || "all"` / `role ?? "viewer"` - the F-843 shape exactly;
 *     B. `useState("own")` on a line binding a `*Scope` / `*Role` state;
 *     C. `const scope = <cond> ? "all" : ...` - a ternary standing in for a default.
 *   The defaults live in `src/shared/roster-roles.js` (`DEFAULT_ROSTER_SCOPE` today) and
 *   are imported. Anything else needs an allow-list entry here that says, in words, why
 *   that literal is not a default.
 *
 * WHAT IS DELIBERATELY NOT AN OFFENCE - THE ADMIN-FORCING BRANCH IS A RULE, NOT A DEFAULT.
 *   `role === "admin" ? "all" : <x>` is exempted BY SHAPE (a ternary whose condition tests
 *   `=== "admin"` / `!== "admin"`), and the negative control below pins that. An admin's
 *   scope is "all" BY CONSTRUCTION: both resolvers force it on write, `rosterRowRole`
 *   forces it on read, and the panel forces it in the dropdown. It is not a value anyone
 *   may configure, so there is no default to centralise - hoisting it into roster-roles.js
 *   would invent a knob that the backend does not honour. A DEFAULT answers "nothing was
 *   stated"; this answers "admin was stated", which is the opposite case.
 *
 * BLIND SPOTS, stated rather than papered over: a default reached through a variable
 * (`const WIDE = "all"; scope || WIDE`) is invisible to a textual rule, as is a default
 * assembled at runtime. The rule catches the shape all three findings actually took.
 * ------------------------------------------------------------------------- */
const ROSTER_WORDS = ["own", "all", "viewer", "editor", "admin"];
const ROSTER_LIT = `"(${ROSTER_WORDS.join("|")})"`;
/* "is this binding about a role or a scope?" - the leaf of `user.scope`, the `addRole` of
   a useState pair, the `scope` of `const scope =`. `rulesFilter` / `typeFilter` are NOT,
   which is why the many `useState("all")` filter defaults in App.js are not swept in. */
const ROLEISH = /(scope|role)/i;

/** @returns {{how:string, line:number, text:string}[]} */
function scanRosterDefaults(src) {
  const code = maskComments(src);
  const lineOf = (idx) => code.slice(0, idx).split("\n").length;
  const lines = src.split("\n");
  const out = [];
  const push = (idx, how) => {
    const line = lineOf(idx);
    out.push({ how, line, text: lines[line - 1] || "" });
  };

  /* A. `x.scope || "all"` / `role ?? "viewer"` - the F-843 shape. */
  for (const m of code.matchAll(new RegExp(`([A-Za-z_$][\\w$.]*)\\s*(?:\\|\\||\\?\\?)\\s*${ROSTER_LIT}`, "g"))) {
    if (ROLEISH.test(m[1])) push(m.index, `${m[1]} || ${JSON.stringify(m[2])}`);
  }

  /* B. `const [addScope, setAddScope] = useState("own")`. */
  for (const m of code.matchAll(new RegExp(`\\[\\s*([A-Za-z_$][\\w$]*)[^\\]]*\\]\\s*=\\s*useState\\(\\s*${ROSTER_LIT}\\s*\\)`, "g"))) {
    if (ROLEISH.test(m[1])) push(m.index, `useState(${JSON.stringify(m[2])}) for ${m[1]}`);
  }

  /* C. `const scope = <cond> ? "all" : ...` - a ternary standing in for a default. The
     admin-forcing condition is exempt by shape: it is a rule, not a default. */
  for (const m of code.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*([^;\\n]*?)\\?\\s*\\(?\\s*${ROSTER_LIT}`, "g"))) {
    if (!ROLEISH.test(m[1])) continue;
    if (/[!=]==\s*"admin"/.test(m[2])) continue;          // admin is "all" BY CONSTRUCTION
    push(m.index, `${m[1]} = <cond> ? ${JSON.stringify(m[3])}`);
  }

  /* C2. the ELSE arm of the same shape - `const roleOf = (t) => (ok ? t.role : "admin")`.
     A fallback is a default wherever it sits in the ternary, and the widest value is the
     one that hurts. Same admin-forcing exemption. */
  for (const m of code.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*([^;\\n]*?)\\?[^;\\n]*?:\\s*\\(?\\s*${ROSTER_LIT}`, "g"))) {
    if (!ROLEISH.test(m[1])) continue;
    if (/[!=]==\s*"admin"/.test(m[2])) continue;
    push(m.index, `${m[1]} = <cond> ? ... : ${JSON.stringify(m[3])}`);
  }
  return out.sort((a, b) => a.line - b.line);
}

/* POSITIVE CONTROL: the pre-F-843 PermissionsTab line, verbatim. If this stops firing the
   arm is dead and the finding could ship again unseen. */
const PRE_F843 = `            const scope = typeof user === "object" ? (user.scope || "all") : "all";\n`;
ok(scanRosterDefaults(PRE_F843).length > 0,
  "positive control: the pre-F-843 `user.scope || \"all\"` line is flagged");

/* NEGATIVE CONTROL: the admin-forcing branch, in both live shapes. A RULE, not a default. */
const ADMIN_FORCING = `
const effectiveScope = addRole === "admin" ? "all" : addScope;
const nextScope = newRole === "admin" ? "all" : (newScope || DEFAULT_ROSTER_SCOPE);
`;
ok(scanRosterDefaults(ADMIN_FORCING).length === 0,
  "negative control: `role === \"admin\" ? \"all\"` is a RULE (admin is all by construction), not a default");

/* NEGATIVE CONTROL: the shared default, imported and named, is the shape we want. */
ok(scanRosterDefaults(`const scope = user.scope || DEFAULT_ROSTER_SCOPE;\n`).length === 0,
  "negative control: `user.scope || DEFAULT_ROSTER_SCOPE` - the imported default - raises nothing");

/* NEGATIVE CONTROL: a list filter that happens to be called "all" is not a roster scope. */
ok(scanRosterDefaults(`const [rulesFilter, setRulesFilter] = useState("all");\n`).length === 0,
  "negative control: a `rulesFilter` default of \"all\" is a filter, not a roster scope");

const ROSTER_ALLOW = [
  { file: "components/PermissionsTab.jsx", match: 'const role = typeof user === "object" ? (user.role || "admin")',
    why: "the LEGACY-ROW rule, not a default: a bare account-id string (and an object with no role at all) IS an admin row - that is what the backend's rosterRowRole reads it as, and F-840 deliberately did not narrow it. Mirroring a rule the read enforces, not inventing a configurable default" },
  { file: "components/ApiAccessPanel.jsx", match: 'const roleOf = (t) =>',
    why: "an API-TOKEN role, not a roster row: this panel keeps its own ROLES list for token scopes and falls back to \"admin\" for a token whose role is unrecognised. Shares the words, not the vocabulary - see the finding filed against this fallback being the WIDEST value" },
  { file: "components/ApiAccessPanel.jsx", match: 'useState("admin")',
    why: "the token-creation form's initial selection (same API-TOKEN vocabulary as the entry above), not the scope a roster row confers" },
];

const rosterUsed = new Set();
const rosterOffences = [];
for (const file of sources) {
  const rel = relative(join(REPO, "static"), file).split(sep).join("/");
  for (const hit of scanRosterDefaults(readFileSync(file, "utf8"))) {
    const idx = ROSTER_ALLOW.findIndex((a) => rel.endsWith(a.file) && hit.text.includes(a.match));
    if (idx >= 0) { rosterUsed.add(idx); continue; }
    rosterOffences.push(`${rel}:${hit.line}  ${hit.how}\n      ${hit.text.trim().slice(0, 140)}`);
  }
}
ok(rosterOffences.length === 0, rosterOffences.length === 0
  ? "no UI file types a roster role/scope DEFAULT literal - they come from src/shared/roster-roles.js"
  : `${rosterOffences.length} roster default literal(s) outside roster-roles.js:\n    ` + rosterOffences.join("\n    "));

const rosterStale = ROSTER_ALLOW.map((a, i) => (rosterUsed.has(i) ? null : `${a.file} "${a.match}"`)).filter(Boolean);
ok(rosterStale.length === 0, rosterStale.length === 0
  ? `all ${ROSTER_ALLOW.length} roster allow-list entries still match a live line`
  : `stale roster allow-list entries (re-read the reason before deleting):\n    ` + rosterStale.join("\n    "));

/* ---------------------------------------------------------------------------
 * 7. THE CAP GUARD SOURCES (F-855)
 *
 * Files outside the UI apps whose JOB is to guard these caps. They are scanned with the
 * same scanner PLUS the declaration form, because a guard that retypes the number it
 * guards asserts against its own copy and goes green while the app and the cap disagree.
 *
 * `builtin-seeds.test.mjs` is here because it did exactly that: `const DOC_CONTENT_MAX =
 * 200000` with `d.content.length` next to it, a CHARACTER count against a cap that F-836
 * had already established is BYTES. Moving `DOC_CONTENT_MAX_BYTES` would have left that
 * suite green and the Documentation Library over the KVS value ceiling.
 *
 * The list is NAMED, not a glob over `test-harness/scripts`, for the reason measured on
 * `src/index.js`: 249 uncited hits there, almost all of them display truncations that
 * coincide with a cap. Each file is added with the sweep that makes it clean.
 * ------------------------------------------------------------------------- */
const GUARDS = [
  "test-harness/scripts/builtin-seeds.test.mjs",
];

/* The guards' own coincidences. Same shape and same rule as ALLOW, kept separate so the
   UI list is not diluted by numbers that only ever appear in a test. */
const GUARD_ALLOW = [
  { file: "scripts/builtin-seeds.test.mjs", value: 100, match: "const DOC_TITLE_MAX = 100",
    why: "the TITLE bound, `title.substring(0, 100)` in saveContextDoc. It is owned by index.js and has no home in registry-limits.js, so there is nothing to import; it coincides with GENERATION_META_LIMITS.maxIdChars, which bounds a generated step id" },
  { file: "scripts/builtin-seeds.test.mjs", value: 200, match: "d.content.length < 200",
    why: "a FLOOR - a seeded doc shorter than 200 characters is a stub, not a document. The caps enumerated here are maxima, and it coincides with MAX_MEMORIES among others" },
  { file: "scripts/builtin-seeds.test.mjs", value: 300, match: "const NAME_MAX = 80,",
    why: "DESCRIPTION_MAX, a skills.js cap (skill description length). Its home is src/skills.js, not registry-limits.js; it coincides with WEB_SEARCH_BRAKE_MAX_PER_BUCKET" },
  { file: "scripts/builtin-seeds.test.mjs", value: 10, match: "const NAME_MAX = 80,",
    why: "TAGS_MAX, a skills.js cap (tags per skill), coinciding with VA_HISTORY_MAX / WEB_SEARCH_MAX_PER_RUN" },
  { file: "scripts/builtin-seeds.test.mjs", value: 30, match: "const NAME_MAX = 80,",
    why: "TAG_LEN_MAX, a skills.js cap (characters per tag), coinciding with VA_ANTI_PILE_UP_DAYS_MAX / VA_EFFECT_TTL_DAYS" },
  { file: "scripts/builtin-seeds.test.mjs", value: 4, match: "const apiRefs =",
    why: "`x.slice(4)` drops the literal prefix `api.` from a matched `api.method` reference - a string offset, not a count, and it coincides with MAX_RULE_SKILL_IDS" },
];

const guardUsed = new Set();
const guardOffences = [];
for (const rel of GUARDS) {
  const full = join(REPO, ...rel.split("/"));
  const src = readFileSync(full, "utf8");
  const importsShared = /from\s+["'][^"']*registry-limits(\.js)?["']/.test(maskComments(src));
  ok(importsShared, `${rel} imports registry-limits.js rather than retyping its numbers`);
  for (const hit of scanSource(src, { declarations: true })) {
    const cited = citations(hit.names).some((n) => new RegExp(`\\b${n}\\b`).test(hit.text));
    if (cited && importsShared) continue;
    const idx = GUARD_ALLOW.findIndex((a) => rel.endsWith(a.file) && a.value === hit.value && hit.text.includes(a.match));
    if (idx >= 0) { guardUsed.add(idx); continue; }
    guardOffences.push(`${rel}:${hit.line}  ${hit.value} via ${hit.how} looks like ${hit.names.join(" | ")}\n      ${hit.text.trim().slice(0, 140)}`);
  }
}
ok(guardOffences.length === 0, guardOffences.length === 0
  ? `the ${GUARDS.length} cap guard source(s) cite the shared caps instead of retyping them`
  : `${guardOffences.length} literal(s) in a cap guard equal a shared cap with no import, no name and no allow-list entry:\n    ` + guardOffences.join("\n    "));

const guardStale = GUARD_ALLOW.map((a, i) => (guardUsed.has(i) ? null : `${a.file} ${a.value} "${a.match}"`)).filter(Boolean);
ok(guardStale.length === 0, guardStale.length === 0
  ? `all ${GUARD_ALLOW.length} guard allow-list entries still match a live line`
  : `stale guard allow-list entries:\n    ` + guardStale.join("\n    "));

/* POSITIVE CONTROL for the declaration form: the exact line F-855 removed. */
const PRE_F855 = `const DOC_TITLE_MAX = 100, DOC_CONTENT_MAX = 200000;\n`;
ok(scanSource(PRE_F855, { declarations: true }).some((h) => h.value === 200000 && h.names.includes("DOC_CONTENT_MAX_BYTES")),
  "positive control: the pre-F-855 `DOC_CONTENT_MAX = 200000` is flagged against DOC_CONTENT_MAX_BYTES");
ok(scanSource(PRE_F855).length === 0,
  "negative control: …and it stays invisible WITHOUT the declaration form, which is why the retype survived section 5");

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} - ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
