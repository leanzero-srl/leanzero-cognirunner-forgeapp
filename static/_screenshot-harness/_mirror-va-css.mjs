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
 *
 * F-623: that promise had a hole on the READ side. `spliceBlock` was careful to search END
 * from the START index, but `extractBlock` searched both from byte 0 and only refused when
 * one was absent. If END ever appeared ABOVE START in App.js, `b < a`, the slice ran backwards
 * and came out EMPTY, no guard fired, and spliceBlock then wrote head+tail with the whole
 * mirrored region gone — the exact truncation F-618 was written to prevent, reached by a
 * different door. Both markers are now anchored the same way: END is only ever looked for AT
 * OR AFTER START, so `b < a` is unreachable rather than merely unlikely.
 *
 * WHY THIS IS PLAUSIBLE AND NOT THEORETICAL: END is `.va-refused { font-weight: 600; }`, a
 * CONTENT line rather than a sentinel comment (the F-618 row notes this). Anybody tidying
 * injectStyles() — moving that one-liner up beside the other refusal rules, or duplicating it
 * — silently arms the bug, and the script's own success message ("mirror updated (1 lines)")
 * reads like a normal run.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const START = "/* ── AGENTS (1.5)";
export const END = ".va-refused { font-weight: 600; }";

/**
 * Extract the dedented AGENTS block from admin-panel App.js injectStyles().
 *
 * F-623 — END is searched FROM the START index, never from byte 0, so the extracted block
 * can never run backwards. The two refusals are told apart in the message because they are
 * different mistakes with different fixes: "no end marker at all" means somebody deleted or
 * reworded the rule, while "end marker only ABOVE the start marker" means somebody MOVED it,
 * which is the case that used to produce an empty block and a deleted region instead of an
 * error. The empty-block assertion below is belt-and-braces: with an anchored search it is
 * unreachable, and it stays so that a future change to the markers cannot quietly restore
 * the silent-empty path.
 */
export function extractBlock(appJs) {
  const start = `    ${START}`;
  const end = `    ${END}`;
  const a = appJs.indexOf(start);
  if (a < 0) {
    throw new Error(
      `AGENTS block not found in injectStyles(): start marker ${JSON.stringify(START)} is missing.`
    );
  }
  const b = appJs.indexOf(end, a);
  if (b < 0) {
    const stray = appJs.indexOf(end);
    throw new Error(
      stray >= 0
        ? `refusing to read the AGENTS block: end marker ${JSON.stringify(END)} appears ABOVE the start marker, ` +
          "not below it, so the block has no extent. Move it back under the AGENTS region rather than letting " +
          "the mirror extract nothing and delete the region (F-623)."
        : `AGENTS block not found in injectStyles(): end marker ${JSON.stringify(END)} is missing after the start marker.`
    );
  }
  const block = appJs
    .slice(a, b + end.length)
    .split("\n")
    .map((l) => l.replace(/^ {4}/, ""))
    .join("\n");
  if (!block.trim()) {
    throw new Error("refusing to read the AGENTS block: the extracted block is empty (F-623).");
  }
  return block;
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
  /* F-623 — BOTH refusals are presented the same way: the sentence, no stack trace, exit 2.
     extractBlock used to throw straight out of main() while spliceBlock's refusal was caught
     and printed, so the two halves of "refuse rather than truncate" looked like different
     events to anyone running this — one a clean message, the other a crash. Same outcome,
     same presentation. styles.css is not opened until the block is in hand, so an extract
     refusal cannot touch the file. */
  let block;
  let css;
  try {
    block = extractBlock(fs.readFileSync(appPath, "utf8"));
    css = fs.readFileSync(cssPath, "utf8");
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
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
