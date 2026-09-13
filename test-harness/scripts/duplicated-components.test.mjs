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
// The LIST is parsed out of CLAUDE.md rather than retyped here: a test with its own copy of the
// convention is the same defect one layer up. Add a component to that sentence and it is covered
// on the next run; the parse is guarded by a positive control so a reworded CLAUDE.md fails loudly
// instead of silently checking nothing.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// CR_DUP_ROOT lets this suite be pointed at a COPY of the tree, which is how its own
// drift detection is verified without editing a real component (see the commit for F-192).
const ROOT = process.env.CR_DUP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APPS = ["config-ui", "admin-panel"];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// --- parse the convention out of CLAUDE.md -------------------------------------------------
const claudeMd = readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
const sentence = claudeMd.split("\n").find((line) => line.includes("are **byte-identical copies**"));
ok(!!sentence, "CLAUDE.md still states the byte-identical-copies convention (positive control)");
if (!sentence) { console.log("\nduplicated-components: cannot proceed without the convention sentence"); process.exit(1); }

const backticked = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const duplicated = backticked(sentence.slice(0, sentence.indexOf("are **byte-identical copies**")));
const divergedText = sentence.slice(sentence.indexOf("Do NOT blind-copy"));
const diverged = backticked(divergedText.slice(0, divergedText.indexOf("—") + 1 || undefined));

ok(duplicated.length >= 9, `the parse found the duplicated set (${duplicated.length}): ${duplicated.join(", ")}`);
ok(diverged.length >= 5, `the parse found the deliberately-diverged set (${diverged.length}): ${diverged.join(", ")}`);
ok(duplicated.includes("FunctionBlock.jsx") && duplicated.includes("components/editor/*"),
  "positive control: the parse really read the component names, globs included");
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

ok(drifted.length === 0,
  drifted.length
    ? `DUPLICATED COMPONENTS HAVE DRIFTED — first: ${drifted[0]}${drifted.length > 1 ? ` (and ${drifted.length - 1} more: ${drifted.slice(1).map((d) => d.split(" — ")[0]).join(", ")})` : ""}. Copy config-ui → admin-panel and rebuild BOTH apps.`
    : `all ${targets.length} duplicated components are byte-identical between ${APPS.join(" and ")}`);

console.log(`\nduplicated-components: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
