/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Constant forge-logs monitor. Run in the background for the WHOLE duration of a
// deep/discovery run; it polls forge logs, appends new lines to a capture file,
// and prints a live alert for every SYSTEM-bug signature it sees (5xx, parse
// failures, tool-call shape, mcp-bridge errors, transient markers, stack traces).
// Pass --review to do a one-shot review of an existing capture file instead.
//
//   node scripts/_forge-logs.mjs                 # tail (background during runs)
//   node scripts/_forge-logs.mjs --interval=15
//   node scripts/_forge-logs.mjs --review        # map captured errors → fixes

import { forgeAvailable, pollForgeLogs, scanForSignals, reviewLogFile, PROJECT_ROOT } from "../lib/forge-logs.mjs";
import { RESULTS_DIR, ensureResults } from "../lib/state.mjs";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (n, d) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=")[1] : d; };
const OUT = arg("out", join(RESULTS_DIR, "forge-logs.txt"));
const INTERVAL = parseInt(arg("interval", "20"), 10) * 1000;
const REVIEW = argv.includes("--review");

if (REVIEW) {
  const r = reviewLogFile(OUT);
  console.log(`=== forge-logs review: ${OUT} ===`);
  console.log(`${r.found} error line(s) across ${Object.keys(r.signals).length} signature(s).\n`);
  if (!r.found) console.log("No system-bug signatures found in the captured logs.");
  for (const [sig, info] of Object.entries(r.signals)) {
    console.log(`  ${info.count}× ${sig}  →  ${info.hardeningTarget || "(investigate the resolver/executor path)"}`);
    for (const s of info.samples) console.log(`      ${s}`);
    console.log("");
  }
  process.exit(0);
}

ensureResults();
if (!forgeAvailable()) {
  console.log("forge CLI not available (or not logged in) — forge-logs monitor is a no-op here.");
  console.log("Run this from a machine with `forge` installed + `forge login` done, from the project root.");
  process.exit(0);
}

console.log(`Tailing forge logs (project ${PROJECT_ROOT}) every ${INTERVAL / 1000}s → ${OUT}`);
if (!existsSync(OUT)) writeFileSync(OUT, "");

const seen = new Set();
let polls = 0, alerts = 0, errs = 0;

function tick() {
  const { ok, lines, error } = pollForgeLogs();
  polls++;
  if (!ok && error) { errs++; if (errs <= 2) console.log(`  (forge logs poll error: ${String(error).slice(0, 120)})`); return; }
  const fresh = lines.filter((l) => !seen.has(l));
  for (const l of fresh) seen.add(l);
  if (fresh.length) appendFileSync(OUT, fresh.join("\n") + "\n");
  for (const s of scanForSignals(fresh)) { alerts++; console.log(`  ⚠ [${s.signal}] ${s.line.replace(/\s+/g, " ").slice(0, 170)}`); }
}

tick();
const timer = setInterval(tick, INTERVAL);
function stop() {
  clearInterval(timer);
  console.log(`\nforge-logs monitor stopped: ${polls} poll(s), ${alerts} alert(s). Captured → ${OUT}`);
  console.log(`Review with: node scripts/_forge-logs.mjs --review`);
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
