/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-192 — the config-ui ↔ admin-panel duplicated-component convention, ENFORCED.
//
// CLAUDE.md says a named set of components are byte-identical copies between
// static/config-ui/src/components/ and static/admin-panel/src/components/, and that the way to
// keep them that way is a human remembering to run `diff -q`. Nothing checked it. The browser
// suites verify each app's copy through a DIFFERENT suite (editor-journeys drives config-ui,
// listeners-jobs drives admin-panel) against regex-loose assertions, so two copies can say
// different sentences and both stay green — which is the exact condition F-179 was filed to end,
// and the one-file habit this repo has paid for in F-174, F-175, F-179 and F-181.
//
// F-231 — WHERE THE LIST LIVES. It used to be parsed out of CLAUDE.md, on the reasoning that
// a test with its own copy of the convention is the same defect one layer up. But CLAUDE.md is
// GITIGNORED and untracked in this repo (`git ls-files CLAUDE.md` is empty), so the suite died
// with ENOENT on a `git archive` of HEAD, a clean clone, or any CI checkout — a gate that cannot
// run outside one laptop is not a gate. The canonical list therefore lives HERE, in the tracked
// file that enforces it, and the doc is checked AGAINST it when the doc is present. That keeps
// one home for the rule (this file) and still refuses to let CLAUDE.md drift away from it.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// CR_DUP_ROOT lets this suite be pointed at a COPY of the tree, which is how its own
// drift detection is verified without editing a real component (see the commit for F-192).
const ROOT = process.env.CR_DUP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APPS = ["config-ui", "admin-panel"];

// THE CANONICAL SETS. Adding a component to the duplication convention means adding it here;
// the CLAUDE.md cross-check below then tells you the doc needs the same edit.
export const DUPLICATED_COMPONENTS = [
  "FunctionBlock.jsx", "FunctionBuilder.jsx", "CodeEditor.jsx", "DocRepository.jsx",
  "AILoadingState.jsx", "KnowledgePanel.jsx", "SkillsTab.jsx", "SkillEditor.jsx",
  // F-237 — these three were byte-identical in both apps while the lists said
  // otherwise: PremadeRuleForm.jsx was in NEITHER list (so nothing held it equal),
  // and IssuePicker.jsx / Skeleton.jsx were filed as "deliberately diverged" when
  // they are identical — a claim that licenses the next editor to fork them.
  // toast.js (not .jsx) was likewise identical and unlisted — the reality scan below
  // is what found it.
  // F-436 — capability.js (the getAgentCapability retry ladder and the ONE wording for a
  // read that never came back) is a THIRD shared helper of the refusal.js kind: the pair
  // below plus a copy at issue-glance/src/capability.js, which the identity block at the
  // bottom of this file holds equal.
  "MemoriesTab.jsx", "PremadeRuleForm.jsx", "IssuePicker.jsx", "Skeleton.jsx", "toast.js", "refusal.js",
  "capability.js",
  // 1.4 commit 14b — the field-guide chip is a fourth shared helper of that kind, gated like
  // capability.js. F-572 gave it a FOURTH home: config-view, the read-only review surface,
  // which renders provenance and had been left out of the chip when 14b landed. Homes:
  // config-ui, admin-panel, issue-glance, config-view — the last two held equal by the
  // explicit block near the bottom of this file, since the walk only sees the pair.
  "FieldGuideChip.jsx",
  "components/editor/*",
];
// Deliberately DIVERGED — never blind-copied between the two apps. Verified by
// `cmp -s` at the F-237 cut: these three really do differ. SemanticConfig.jsx also
// exists in both apps and differs, but it is in NEITHER list on purpose — it is not
// part of the copy convention and nothing claims it is.
export const DIVERGED_COMPONENTS = [
  "CustomSelect.jsx", "Tooltip.jsx", "ReviewPanel.jsx",
];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// --- the doc may not drift from the list above (skipped when the doc is absent) -------------
const claudeMdPath = path.join(ROOT, "CLAUDE.md");
if (!existsSync(claudeMdPath)) {
  console.log("note: CLAUDE.md is not present (it is gitignored) — the doc cross-check is SKIPPED; the component comparison below still runs in full");
} else {
  const claudeMd = readFileSync(claudeMdPath, "utf8");
  const sentence = claudeMd.split("\n").find((line) => line.includes("are **byte-identical copies**"));
  ok(!!sentence, "CLAUDE.md still states the byte-identical-copies convention (positive control)");
  if (sentence) {
    const backticked = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const docDuplicated = backticked(sentence.slice(0, sentence.indexOf("are **byte-identical copies**")));
    const divergedText = sentence.slice(sentence.indexOf("Do NOT blind-copy"));
    const docDiverged = backticked(divergedText.slice(0, divergedText.indexOf("—") + 1 || undefined));
    const same = (a, b) => [...a].sort().join(",") === [...b].sort().join(",");
    ok(same(docDuplicated, DUPLICATED_COMPONENTS),
      `CLAUDE.md's duplicated set equals this file's (doc: ${docDuplicated.join(", ")} | test: ${DUPLICATED_COMPONENTS.join(", ")})`);
    ok(same(docDiverged, DIVERGED_COMPONENTS),
      `CLAUDE.md's diverged set equals this file's (doc: ${docDiverged.join(", ")} | test: ${DIVERGED_COMPONENTS.join(", ")})`);
  }
}

const duplicated = DUPLICATED_COMPONENTS;
const diverged = DIVERGED_COMPONENTS;
ok(duplicated.length >= 9, `the duplicated set has ${duplicated.length} entries`);
ok(diverged.length >= 3, `the deliberately-diverged set has ${diverged.length} entries`);
ok(duplicated.includes("FunctionBlock.jsx") && duplicated.includes("components/editor/*"),
  "the set carries component names and globs");
ok(!duplicated.some((f) => diverged.includes(f)), "no file is in both sets");

// --- expand globs to concrete relative paths -----------------------------------------------
const expand = (entry) => {
  if (!entry.endsWith("/*")) return [entry];
  const dir = entry.slice(0, -2);
  const base = path.join(ROOT, "static", APPS[0], "src", dir);
  if (!existsSync(base)) return [];
  // Union of both apps' directory listings — a file present in only ONE app is a drift too,
  // and listing just the source app would let a stray admin-panel copy hide.
  const names = new Set();
  for (const app of APPS) {
    const d = path.join(ROOT, "static", app, "src", dir);
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isFile()) names.add(e.name);
  }
  return [...names].sort().map((n) => path.posix.join(dir, n));
};

const targets = duplicated.flatMap(expand).map((rel) => (rel.includes("/") ? rel : path.posix.join("components", rel)));
ok(targets.length >= 12, `${targets.length} concrete files to compare (globs expanded)`);

// --- the comparison: BYTES, and name the FIRST drift ---------------------------------------
const drifted = [];
for (const rel of targets) {
  const paths = APPS.map((app) => path.join(ROOT, "static", app, "src", rel));
  const missing = paths.filter((p) => !existsSync(p));
  if (missing.length) {
    drifted.push(`${rel} — missing in ${missing.map((p) => path.relative(ROOT, p)).join(", ")}`);
    continue;
  }
  const [a, b] = paths.map((p) => readFileSync(p));
  if (!a.equals(b)) {
    const [ta, tb] = paths.map((p) => readFileSync(p, "utf8").split("\n"));
    const firstLine = ta.findIndex((line, i) => line !== tb[i]) + 1;
    drifted.push(`${rel} — ${a.length} B in ${APPS[0]} vs ${b.length} B in ${APPS[1]}, first difference at line ${firstLine || Math.min(ta.length, tb.length) + 1}`);
  }
}
// Positive control on the comparison itself: prove it CAN see a difference, so a clean run
// means "identical" and not "the walk read nothing".
{
  const probeA = Buffer.from("x"), probeB = Buffer.from("y");
  ok(!probeA.equals(probeB), "positive control: the byte comparison can distinguish two files");
  const real = path.join(ROOT, "static", APPS[0], "src", targets[0]);
  ok(statSync(real).size > 0, `positive control: ${targets[0]} is a real non-empty file`);
}

// --- F-237: REALITY, not just the list. Every same-named component present in BOTH
// apps is classified by its bytes, and a file the lists get wrong fails here:
//   identical + unlisted        → nothing holds it equal (PremadeRuleForm.jsx was this)
//   identical + "diverged"      → the doc licenses the next editor to fork it
//                                 (IssuePicker.jsx and Skeleton.jsx were this)
//   differs   + "duplicated"    → already caught by the drift walk above
// A file that differs and is in NEITHER list is out of the convention on purpose.
{
  const listed = new Set(targets);
  const walk = (app, dir = "components") => {
    const base = path.join(ROOT, "static", app, "src", dir);
    if (!existsSync(base)) return [];
    const out = [];
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...walk(app, path.posix.join(dir, e.name)));
      else if (/\.(jsx|js)$/.test(e.name)) out.push(path.posix.join(dir, e.name));
    }
    return out;
  };
  const shared = walk(APPS[0]).filter((rel) => existsSync(path.join(ROOT, "static", APPS[1], "src", rel)));
  const misfiled = [];
  for (const rel of shared) {
    const [a, b] = APPS.map((app) => readFileSync(path.join(ROOT, "static", app, "src", rel)));
    const identical = a.equals(b);
    const name = path.posix.basename(rel);
    if (identical && diverged.includes(name)) misfiled.push(`${rel} is byte-identical but filed as deliberately diverged`);
    else if (identical && !listed.has(rel)) misfiled.push(`${rel} is byte-identical in both apps but is in NEITHER list — add it to DUPLICATED_COMPONENTS (and CLAUDE.md)`);
  }
  ok(shared.length >= 12, `positive control: ${shared.length} same-named components exist in both apps`);
  ok(misfiled.length === 0, misfiled.length
    ? `THE LISTS DISAGREE WITH THE BYTES — ${misfiled.join("; ")}`
    : `all ${shared.length} shared components are filed to match their bytes`);
}

/* F-436 — THE THIRD COPY. issue-glance has no components/ directory to share with the pair,
   so its copy of capability.js sits at src/capability.js (the same place its refusal.js does)
   and the walk above cannot see it. Compared by BYTES, because there is no import-depth
   difference to excuse: all three files import nothing but React. */
{
  const pair = path.join(ROOT, "static", "config-ui", "src", "components", "capability.js");
  const glance = path.join(ROOT, "static", "issue-glance", "src", "capability.js");
  ok(existsSync(glance), "issue-glance carries its own copy of capability.js");
  if (existsSync(glance) && existsSync(pair)) {
    ok(readFileSync(pair).equals(readFileSync(glance)),
      "issue-glance's capability.js is byte-identical to the config-ui/admin-panel pair");
  }
}

/* F-572 — THE THIRD AND FOURTH COPIES of FieldGuideChip.jsx. issue-glance and config-view sit
   outside the APPS walk above, so their copies are held equal here the way capability.js's third
   home is. Compared by BYTES: all four live at the same import depth
   (`../../../../src/shared/knowledge-titles.js`), so there is nothing to normalise, and the rule
   the file exists to carry — never print a section id the titles map cannot name — must not fork. */
{
  const chipBase = path.join(ROOT, "static", "config-ui", "src", "components", "FieldGuideChip.jsx");
  const chipHomes = [
    path.join(ROOT, "static", "issue-glance", "src", "components", "FieldGuideChip.jsx"),
    path.join(ROOT, "static", "config-view", "src", "components", "FieldGuideChip.jsx"),
  ];
  for (const home of chipHomes) {
    const rel = path.relative(ROOT, home);
    ok(existsSync(home), `${rel} exists (FieldGuideChip has four homes)`);
    if (existsSync(home) && existsSync(chipBase)) {
      ok(readFileSync(chipBase).equals(readFileSync(home)),
        `${rel} is byte-identical to the config-ui/admin-panel pair`);
    }
  }
}

/* F-582 — THE INDEX IS BACKEND-SIZED AND MUST NOT ENTER A BUNDLE. `knowledge-index.js` is
   136 KB of titles PLUS tags and provenance; the only thing a frontend ever needs from the
   corpus is a title, and `knowledge-titles.js` (25 KB) carries exactly that. Importing the
   index from any app put ~110 KB of never-read bytes into FOUR bundles. The Knowledge tab is
   NOT an exception: it reads packs through the resolver, not from a bundled module. This is a
   source-text check across every app's src/, not just the duplicated pair, because the next
   importer will not be FieldGuideChip. */
{
  const offenders = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") scan(full); continue; }
      if (!/\.(js|jsx|mjs)$/.test(e.name)) continue;
      /* A MODULE SPECIFIER, not any mention: the chips document in prose why they no longer
         read the index, and a comment costs a bundle nothing. Quoted form catches static
         import, dynamic import() and require() alike. */
      if (/["'][^"']*knowledge-index\.js["']/.test(readFileSync(full, "utf8"))) offenders.push(path.relative(ROOT, full));
    }
  };
  let scanned = 0;
  for (const app of readdirSync(path.join(ROOT, "static"), { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const src = path.join(ROOT, "static", app.name, "src");
    if (!existsSync(src)) continue;
    scanned += 1;
    scan(src);
  }
  ok(scanned >= 4, `positive control: scanned the src/ of ${scanned} apps for the index import`);
  ok(offenders.length === 0, offenders.length
    ? `A FRONTEND IMPORTS knowledge-index.js — ${offenders.join(", ")}. Use src/shared/knowledge-titles.js for titles, or the resolver for pack content.`
    : "no file under static/*/src names knowledge-index.js");
}

ok(drifted.length === 0,
  drifted.length
    ? `DUPLICATED COMPONENTS HAVE DRIFTED — first: ${drifted[0]}${drifted.length > 1 ? ` (and ${drifted.length - 1} more: ${drifted.slice(1).map((d) => d.split(" — ")[0]).join(", ")})` : ""}. Copy config-ui → admin-panel and rebuild BOTH apps.`
    : `all ${targets.length} duplicated components are byte-identical between ${APPS.join(" and ")}`);

console.log(`\nduplicated-components: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
