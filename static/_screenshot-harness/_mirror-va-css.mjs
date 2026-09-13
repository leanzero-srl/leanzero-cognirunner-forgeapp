/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dev-only: copy the AGENTS (1.5) CSS block out of admin-panel's injectStyles() — the LIVE
 * source — into src/styles.css, the convention mirror. Derived rather than retyped, so the
 * mirror cannot drift from the block it mirrors on the day it is written.
 * Run: node static/_screenshot-harness/_mirror-va-css.mjs
 *
 * F-618: this script used to TRUNCATE styles.css at the AGENTS start marker, deleting every
 * rule appended after the block (34 lines of .mg-note* / .usage-engine-fill* were lost once).
 * It now replaces ONLY the region between the start and end markers and preserves the bytes
 * before and after it exactly; a missing end marker is a refusal, never a truncation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const START = "/* ── AGENTS (1.5)";
export const END = ".va-refused { font-weight: 600; }";

/** Extract the dedented AGENTS block from admin-panel App.js injectStyles(). */
export function extractBlock(appJs) {
  const a = appJs.indexOf(`    ${START}`);
  const b = appJs.indexOf(`    ${END}`);
  if (a < 0 || b < 0) throw new Error("AGENTS block not found in injectStyles()");
  return appJs
    .slice(a, b + `    ${END}`.length)
    .split("\n")
    .map((l) => l.replace(/^ {4}/, ""))
    .join("\n");
}

/**
 * Splice `block` into `css`, replacing only the marked region.
 * Everything before START and after END is returned byte-for-byte.
 * Throws when START is present but END is not (refuse rather than truncate).
 */
export function spliceBlock(css, block) {
  const at = css.indexOf(START);
  if (at < 0) {
    // No region yet — append below the existing content, which is left untouched.
    return `${css.replace(/\s+$/, "")}\n\n${block}\n`;
  }
  const endAt = css.indexOf(END, at);
  if (endAt < 0) {
    throw new Error(
      `refusing to write styles.css: AGENTS start marker found but end marker ${JSON.stringify(END)} is missing — ` +
        "the mirrored region has no end, and truncating here would delete every rule below it (F-618)."
    );
  }
  const head = css.slice(0, at);
  const tail = css.slice(endAt + END.length);
  return `${head}${block}${tail}`;
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "../..");
  const appPath = process.env.MIRROR_APP_JS || path.join(root, "static/admin-panel/src/App.js");
  const cssPath = process.env.MIRROR_CSS_PATH || path.join(root, "static/admin-panel/src/styles.css");
  const block = extractBlock(fs.readFileSync(appPath, "utf8"));
  const css = fs.readFileSync(cssPath, "utf8");
  let next;
  try {
    next = spliceBlock(css, block);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (next === css) {
    console.log(`styles.css mirror already in sync (${block.split("\n").length} lines)`);
    return;
  }
  fs.writeFileSync(cssPath, next);
  console.log(`styles.css mirror updated (${block.split("\n").length} lines)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
