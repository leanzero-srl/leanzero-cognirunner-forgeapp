/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * F-618 — offline guard for the VA CSS mirror. The script used to truncate styles.css at the
 * AGENTS start marker, silently deleting every rule appended below it. These cases run the real
 * script (as a subprocess, over a temp fixture) and assert that the trailing block survives
 * byte-for-byte, that the AGENTS region is actually replaced, and that a missing end marker
 * refuses instead of writing.
 *
 * F-623 — the same promise, on the READ side. These cases covered a missing END and a preserved
 * tail, but not an END that sits ABOVE the START marker in App.js. That case used to extract an
 * EMPTY block (the slice ran backwards) and then delete the whole mirrored region, so the one
 * guard the F-618 cases assert was routed around rather than broken. The inverted-marker case
 * below is the missing one: it must REFUSE, and styles.css must be untouched byte-for-byte.
 * Run: node static/_screenshot-harness/mirror-va-css.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "_mirror-va-css.mjs");

const HEAD = `/* head rules — must survive */\n.before { color: #2563eb; }\n\n`;
const TAIL = `\n\n/* ── trailing block appended AFTER agents ── */\n.mg-note { padding: 10px 12px; }\n.usage-engine-fill.eng-forge { background: #2563eb; }\n`;

const FIXTURE_APP_JS = [
  "function injectStyles() {",
  "  const css = `",
  "    /* ── AGENTS (1.5) — fixture block ── */",
  "    .va-tab { display: flex; }",
  "    .va-refused { font-weight: 600; }",
  "  `;",
  "}",
  "",
].join("\n");

const NEW_BLOCK = [
  "/* ── AGENTS (1.5) — fixture block ── */",
  ".va-tab { display: flex; }",
  ".va-refused { font-weight: 600; }",
].join("\n");

const STALE_BLOCK = [
  "/* ── AGENTS (1.5) — stale mirrored copy ── */",
  ".va-tab { display: block; }",
  ".va-refused { font-weight: 600; }",
].join("\n");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "f618-mirror-"));
}

/* `appJs` defaults to the well-formed fixture; F-623 passes a mutated App.js instead, because
   the defect it pins lives in what the script READS, not in what styles.css already contains. */
function run(dir, css, appJs = FIXTURE_APP_JS) {
  const appPath = path.join(dir, "App.js");
  const cssPath = path.join(dir, "styles.css");
  fs.writeFileSync(appPath, appJs);
  fs.writeFileSync(cssPath, css);
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, MIRROR_APP_JS: appPath, MIRROR_CSS_PATH: cssPath },
  });
  return { res, after: fs.readFileSync(cssPath, "utf8") };
}

const cases = [];
function test(name, fn) {
  cases.push([name, fn]);
}

test("a trailing block after AGENTS survives a run byte-for-byte", () => {
  const dir = tmpdir();
  const { res, after } = run(dir, HEAD + STALE_BLOCK + TAIL);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(after.endsWith(TAIL), "the tail after the AGENTS region was not preserved byte-for-byte");
  assert.ok(after.startsWith(HEAD), "the head before the AGENTS region was not preserved byte-for-byte");
  assert.equal(after, HEAD + NEW_BLOCK + TAIL, "only the AGENTS region should change");
});

test("the AGENTS region is replaced with the block from App.js", () => {
  const dir = tmpdir();
  const { res, after } = run(dir, HEAD + STALE_BLOCK + TAIL);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(after.includes(".va-tab { display: flex; }"), "the fresh block was not written");
  assert.ok(!after.includes(".va-tab { display: block; }"), "the stale block was not replaced");
  assert.equal(after.split(".va-refused").length - 1, 1, "the region was duplicated instead of replaced");
});

test("a missing end marker refuses instead of truncating", () => {
  const dir = tmpdir();
  const broken = HEAD + "/* ── AGENTS (1.5) — no end marker here ── */\n.va-tab { display: block; }" + TAIL;
  const { res, after } = run(dir, broken);
  assert.notEqual(res.status, 0, "the script should refuse when the end marker is missing");
  assert.match(res.stderr, /end marker/i, "the refusal should say why");
  assert.equal(after, broken, "styles.css must be left untouched on a refusal");
});

/* F-623 — the END marker is a CONTENT line (`.va-refused { font-weight: 600; }`), not a
   sentinel comment, so moving it up beside the other refusal rules is an ordinary tidy-up.
   Before the fix this printed "styles.css mirror updated (1 lines)" and returned exit 0 while
   deleting the entire AGENTS region from the mirror. */
test("an end marker ABOVE the start marker refuses instead of emptying the region", () => {
  const dir = tmpdir();
  const invertedAppJs = [
    "function injectStyles() {",
    "  const css = `",
    "    .va-refused { font-weight: 600; }",
    "    /* \u2500\u2500 AGENTS (1.5) \u2014 fixture block \u2500\u2500 */",
    "    .va-tab { display: flex; }",
    "  `;",
    "}",
    "",
  ].join("\n");
  const before = HEAD + STALE_BLOCK + TAIL;
  const { res, after } = run(dir, before, invertedAppJs);
  assert.notEqual(res.status, 0, "the script must refuse when the end marker precedes the start marker");
  assert.match(res.stderr, /end marker/i, "the refusal should say which marker is wrong");
  assert.match(res.stderr, /above/i, "the refusal should say the end marker is above the start marker");
  assert.equal(after, before, "styles.css must be left untouched byte-for-byte on a refusal");
  assert.ok(after.endsWith(TAIL), "the trailing block must survive an inverted-marker refusal");
  assert.ok(after.includes(".va-tab { display: block; }"), "the existing AGENTS region must not be emptied");
});

/* The neighbouring refusal must keep its own message: an END that is absent entirely is a
   different mistake from an END that merely moved, and the two are told apart on purpose. */
test("an end marker missing from App.js entirely still refuses, with its own message", () => {
  const dir = tmpdir();
  const noEndAppJs = [
    "function injectStyles() {",
    "  const css = `",
    "    /* \u2500\u2500 AGENTS (1.5) \u2014 fixture block \u2500\u2500 */",
    "    .va-tab { display: flex; }",
    "  `;",
    "}",
    "",
  ].join("\n");
  const before = HEAD + STALE_BLOCK + TAIL;
  const { res, after } = run(dir, before, noEndAppJs);
  assert.notEqual(res.status, 0, "the script must refuse when App.js has no end marker");
  assert.match(res.stderr, /end marker/i, "the refusal should say which marker is missing");
  assert.ok(!/above/i.test(res.stderr), "a missing end marker must not be reported as one sitting above the start");
  assert.equal(after, before, "styles.css must be left untouched byte-for-byte on a refusal");
});

test("no AGENTS region at all appends without dropping existing rules", () => {
  const dir = tmpdir();
  const base = "/* only head */\n.before { color: #2563eb; }\n";
  const { res, after } = run(dir, base);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(after.startsWith("/* only head */\n.before { color: #2563eb; }"), "existing rules were dropped");
  assert.ok(after.includes(NEW_BLOCK), "the block was not appended");
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${e.message}`);
  }
}
console.log(`mirror-va-css: ${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
