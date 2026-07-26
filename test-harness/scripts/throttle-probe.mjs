/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Throttle-ceiling probe. Bursts a workflow transition across ALL project issues
// at increasing concurrency levels and measures throughput + rate-limiting (429s
// + Retry-After waits) at each level — finding where the Jira transition API
// starts throttling. Alternates Done/Backlog per level so every transition is
// valid (never a no-op self-target) and issues keep moving.
//
// Env: PROBE_LEVELS (comma list, default "25,50,100,150"), PROBE_COUNT (0=all).

import { getTransitions, doTransition, mapLimit, searchJql, stats, resetStats } from "../lib/jira.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

const LEVELS = (process.env.PROBE_LEVELS || "25,50,100,150").split(",").map((x) => parseInt(x, 10));
const COUNT = parseInt(process.env.PROBE_COUNT || "0", 10);

async function main() {
  const s = loadState();
  console.log(`Fetching all issues in ${s.projectKey}...`);
  let keys = (await searchJql(`project = ${s.projectKey} ORDER BY created ASC`, ["status"], 100)).map((i) => i.key);
  if (COUNT > 0) keys = keys.slice(0, COUNT);

  const sample = await getTransitions(keys[0]);
  const byName = {}; for (const t of sample.transitions || []) byName[t.name] = t.id;
  const DONE = byName["Done"], BACKLOG = byName["Backlog"];
  if (!DONE || !BACKLOG) throw new Error("Could not resolve Done/Backlog transitions.");
  console.log(`Probing transition throttle on ${keys.length} issues; levels: ${LEVELS.join(", ")}`);

  const rows = [];
  for (let li = 0; li < LEVELS.length; li++) {
    const C = LEVELS[li];
    const tid = li % 2 === 0 ? DONE : BACKLOG;
    const label = li % 2 === 0 ? "Done" : "Backlog";
    resetStats();
    const codes = {};
    const t0 = Date.now();
    await mapLimit(keys, C, async (key) => {
      const r = await doTransition(key, tid);
      codes[r.status] = (codes[r.status] || 0) + 1;
    });
    const wall = Date.now() - t0;
    const row = {
      concurrency: C, transition: label, issues: keys.length,
      wallMs: wall, throughputPerSec: +(keys.length / (wall / 1000)).toFixed(1),
      requests: stats.requests, http429: stats.status429, http5xx: stats.status5xx,
      retries: stats.retries, retryAfterSec: Math.round(stats.retryAfterMsTotal / 1000),
      finalCodes: codes,
    };
    rows.push(row);
    console.log(`  C=${String(C).padStart(3)} -> ${row.throughputPerSec}/s, requests=${row.requests}, 429=${row.http429}, 5xx=${row.http5xx}, retries=${row.retries}, retryAfter=${row.retryAfterSec}s, codes=${JSON.stringify(codes)}`);
  }

  writeResult("throttle-probe-results.json", { levels: LEVELS, rows });
  const ceiling = rows.find((r) => r.http429 > 0);
  console.log(`\n=== Throttle ceiling ===`);
  if (ceiling) console.log(`  First 429s at concurrency ${ceiling.concurrency} (${ceiling.http429} of ${ceiling.requests} requests). The client transparently retried them (no caller-visible failures).`);
  else console.log(`  No 429s observed up to concurrency ${LEVELS[LEVELS.length - 1]} — the transition API absorbed every burst.`);
  console.log("Results -> results/throttle-probe-results.json");
}

main().catch((e) => { console.error("THROTTLE-PROBE FAILED:", e.message); process.exit(1); });
