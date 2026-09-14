/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * F-827 - AN EM DASH IN UI COPY IS A STANDING OWNER REFUSAL, SO IT NEEDS A GATE.
 *
 * The owner's rule is not a preference and not a review comment: no em dash (U+2014) and
 * no en dash (U+2013) in text this app shows a human. It has been re-applied by hand at
 * least three times (F-820 took it out of the doc-size hint; F-827 took it out of the four
 * memory-store refusals in `src/shared/registry-limits.js`) and it came straight back each
 * time, because nothing in the build could see it. A rule that only a reviewer enforces is
 * a rule that ships broken on the week nobody reviews.
 *
 * THE RULE THIS FILE ENFORCES
 *   No U+2014 and no U+2013 anywhere in the CODE BYTES (comments excluded) of
 *   `static/{config-ui,admin-panel,config-view,issue-glance}/src/**\/*.{js,jsx}` or
 *   `src/shared/*.js`, unless the line is covered by an ALLOW entry below that says, in
 *   words, why the character is not copy.
 *
 * WHY THE SCOPE IS "CODE BYTES", NOT "STRING LITERALS". Half of this app's user-visible
 * text is JSX TEXT, not a quoted string - `<span>Dry run, no transition is blocked</span>`
 * carries no quotes at all. A literal-only scan would have missed the majority of the 439
 * conversions this finding made. So the scan takes everything that is not a comment.
 *
 * WHAT IS MASKED, AND WHY IT IS TWO PASSES (MEASURED)
 *   1. `maskComments` from `test-harness/lib/js-source-scan.mjs` - the ONE home for "which
 *      bytes are a comment", in its keep-literals mode. Prose in a docblock explaining this
 *      very rule must not be its own first offender.
 *   2. `/*...*\/` spans in what SURVIVES pass 1. `injectStyles()` holds each app's live CSS
 *      inside a TEMPLATE LITERAL, so every CSS comment in it is string CONTENT to a JS
 *      scanner and pass 1 correctly keeps it. Measured on the cohort at the time of
 *      writing: 668 flagged lines with this pass, 2,700+ without it, almost all of them
 *      CSS docblocks in App.js. A gate at that signal-to-noise gets switched off.
 *
 * TWO STRUCTURAL EXEMPTIONS, DECLARED HERE RATHER THAN ALLOW-LISTED ONE BY ONE, because
 * both are TYPOGRAPHY and neither is prose:
 *   - A LONE DASH GLYPH as an empty-value placeholder: `{d.transitionName || "-"}` renders
 *     one character in a table cell where there is no value. It is a dash the way an
 *     ellipsis is an ellipsis; rewriting it as a comma is meaningless.
 *   - AN EN DASH BETWEEN NUMBERS as a range: `{start}-{end} of {total}` in the rules and
 *     logs pagers. A range dash is the correct character for the job and reads as a range
 *     in every locale; a hyphen there reads as a minus.
 * Both are recognised by SHAPE, so a new one is covered without anyone editing this file,
 * and neither can hide a sentence: a dash with words on both sides never matches either.
 *
 * WHAT THIS GATE DOES NOT SEE, stated rather than papered over:
 *   - `src/index.js`, `src/memories.js`, `src/skills.js` and the rest of the backend. UI
 *     copy that lives there reaches a human through a resolver answer, and it is NOT in
 *     scope here. The four memory refusals F-827 reworded are in `src/shared/` and ARE
 *     covered; a sentence typed directly into `src/index.js` is not.
 *   - `public/index.html` and every `.css` file.
 *   - Comments. A `--` typed as a dash. A dash inside a base64 blob or a URL.
 *
 * A source scan, not a browser test: both builds render a dash perfectly. It is only
 * wrong to the person reading it.
 *
 * Run: node ui-copy-dashes.test.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { maskComments } from "../../test-harness/lib/js-source-scan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };

const EM = "—";
const EN = "–";

/* ---------------------------------------------------------------------------
 * THE ALLOW-LIST. `file` is matched as a path SUFFIX, `match` as a substring of the
 * offending line. Every entry carries the reason in its own words, because an allow-list
 * whose entries say only "ok" is a list nobody can ever audit.
 * ------------------------------------------------------------------------- */
const ALLOW = [
  {
    file: "src/shared/voice-lint.js",
    match: "DASH_RE",
    why: "The detector itself. `DASH_RE = /[—–]|(?:^|\\s)--(?:\\s|$)/` is the Virtual "
      + "Administrator's outward-text gate for the SAME owner rule, applied to model output. It "
      + "has to contain the characters it refuses, exactly as a spam filter contains the spam.",
  },
  {
    file: "static/admin-panel/src/components/VaSaveNotes.jsx",
    match: "noDashes",
    why: "The converter itself: `String(s).replace(/\\s*[—–]\\s*/g, \", \")` is how a "
      + "save-note sentence coming back from the backend is de-dashed BEFORE it is rendered. "
      + "Rewriting the character class empties the function of its job (it was silently emptied "
      + "once, by F-827's own sweep, which is why this entry names it).",
  },
  {
    file: "src/shared/builtin-docs.js",
    match: null,
    why: "A seeded KNOWLEDGE PACK, not app chrome: markdown document bodies and code samples "
      + "that go into the model's prompt and render as document CONTENT in the Documentation "
      + "Library. Editing their text is a content change that has to bump DOC_SEED_VERSION and "
      + "reseed every tenant, so it is its own cut, with its own gate, not a copy sweep.",
  },
  {
    file: "src/shared/builtin-skills.js",
    match: null,
    why: "Same as builtin-docs.js: seeded instruction packs, fenced into the codegen prompt, "
      + "versioned by SKILL_SEED_VERSION.",
  },
  {
    file: "src/shared/builtin-recipes.js",
    match: null,
    why: "Same again: seeded recipe corpus, model-facing, seed-versioned.",
  },
  {
    file: "src/shared/git-scaffolds.js",
    match: null,
    why: "CI workflow FILE CONTENT, not app copy: the YAML and shell this app writes into a "
      + "customer's repository, and the `::error::` / `::warning::` lines a developer reads in a "
      + "GitHub Actions log. It is content-versioned - git-scaffolds.test.mjs pins a hash and "
      + "refuses any byte change without a SCAFFOLD_VERSION bump plus a changelog line, which "
      + "rewrites the pipeline for every tenant that regenerates. That is its own cut.",
  },
  {
    file: "src/shared/knowledge-titles.js",
    match: null,
    why: "GENERATED - DO NOT EDIT. Baked from knowledge/sources.json by scripts/bake-knowledge.mjs "
      + "and fingerprinted (KNOWLEDGE_TITLES_VERSION). The titles MIRROR pack headings; retyping "
      + "one here desynchronises it from the pack and is overwritten on the next bake.",
  },
  {
    file: "src/shared/knowledge-index.js",
    match: null,
    why: "Generated with knowledge-titles.js from the same bake, pinned by the same fingerprint.",
  },
];

/* ---------------------------------------------------------------------------
 * THE SCAN
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
for (const name of readdirSync(join(REPO, "src", "shared"))) {
  if (name.endsWith(".js")) sources.push(join(REPO, "src", "shared", name));
}
ok(sources.length > 100, `scanned ${sources.length} source files across ${APPS.length} apps and src/shared`);

/** Pass 2: blank `/* ... *\/` spans that survived the JS comment mask (CSS in a template). */
const maskCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

const offences = [];
const used = new Set();
for (const file of sources) {
  const rel = relative(REPO, file).split(sep).join("/");
  const src = readFileSync(file, "utf8");
  const masked = maskCssComments(maskComments(src));
  const rawLines = src.split("\n");
  masked.split("\n").forEach((mline, i) => {
    if (!mline.includes(EM) && !mline.includes(EN)) return;
    const raw = rawLines[i];
    for (let c = 0; c < mline.length; c++) {
      const ch = mline[c];
      if (ch !== EM && ch !== EN) continue;
      const before = raw.slice(Math.max(0, c - 30), c);
      const after = raw.slice(c + 1, c + 30);
      /* Structural exemption 1: an en dash between numbers (or interpolation braces) is a range. */
      if (ch === EN && /[0-9}]\s*$/.test(before) && /^\s*[0-9{]/.test(after)) continue;
      /* Structural exemption 2: a LONE dash glyph, delimited on both sides, is an empty-value
         placeholder - a quote, a backtick, a JSX brace or a tag edge either side of it. */
      if (/(["'`>{]\s*)$/.test(before) && /^(\s*["'`<}])/.test(after)) continue;
      const idx = ALLOW.findIndex((a) => rel.endsWith(a.file) && (a.match === null || raw.includes(a.match)));
      if (idx >= 0) { used.add(idx); continue; }
      offences.push(`${rel}:${i + 1}  ${raw.trim().slice(0, 150)}`);
      return;   // one report per line is enough to find it
    }
  });
}

ok(offences.length === 0, offences.length === 0
  ? `no UI copy carries an em dash or an en dash (${sources.length} files)`
  : `${offences.length} line(s) carry ${EM}/${EN} in UI copy - reword with a comma, a colon or a full stop:\n    `
    + offences.join("\n    "));

const stale = ALLOW.map((a, i) => (used.has(i) ? null : `${a.file}${a.match ? ` "${a.match}"` : ""}`)).filter(Boolean);
ok(stale.length === 0, stale.length === 0
  ? `all ${ALLOW.length} allow-list entries still match a live line`
  : `stale allow-list entries (the code moved on; read the reason before deleting):\n    ` + stale.join("\n    "));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} - ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
