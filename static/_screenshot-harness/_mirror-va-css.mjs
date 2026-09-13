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
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appJs = fs.readFileSync(path.join(root, "static/admin-panel/src/App.js"), "utf8");
const START = "    /* ── AGENTS (1.5)";
const END = "    .va-refused { font-weight: 600; }";
const a = appJs.indexOf(START);
const b = appJs.indexOf(END);
if (a < 0 || b < 0) { console.error("AGENTS block not found in injectStyles()"); process.exit(1); }
const block = appJs.slice(a, b + END.length).split("\n").map((l) => l.replace(/^ {4}/, "")).join("\n");

const cssPath = path.join(root, "static/admin-panel/src/styles.css");
let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* ── AGENTS (1.5)";
const at = css.indexOf(marker);
if (at >= 0) css = css.slice(0, at).replace(/\s+$/, "\n");
fs.writeFileSync(cssPath, `${css.replace(/\s+$/, "")}\n\n${block}\n`);
console.log(`styles.css mirror updated (${block.split("\n").length} lines)`);
