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

function run(dir, css) {
  const appPath = path.join(dir, "App.js");
  const cssPath = path.join(dir, "styles.css");
  fs.writeFileSync(appPath, FIXTURE_APP_JS);
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
