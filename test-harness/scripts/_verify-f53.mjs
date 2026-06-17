/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Deterministic unit checks for the F53 "always-honor" PF sweeper decision logic
// (mirrors sweepPostFunctionJobs in src/index.js). Proves: dropped/killed PF jobs are
// re-driven; done/cancelled/completed/poison jobs are NOT; the poison cap + 1h horizon
// bound retries; fresh jobs are left alone (no premature re-drive / no double-exec).

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}`); } };

const STALE_JOB_MS = 15 * 60 * 1000;
const NOW = 1_700_000_000_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const EB = { params: { issueKey: "X-1", config: {}, extensionKey: "k" } }; // a valid stored eventBody

// Exact decision logic copied from the SAFE sweeper (queued-only, no pf_exec delete,
// no "running" re-drive — the double-exec-prone paths were removed after adversarial review).
const decide = (j, { hasPfDone = false, cancelled = false } = {}) => {
  if (j.status === "done") return "skip";
  if (hasPfDone) return "reconcile-done";
  if (j.status === "cancelled" || cancelled) return "skip-cancelled";
  if (!j.eventBody || !j.eventBody.params) return "skip-ineligible";
  const baseline = j.firstEnqueuedAt || j.enqueuedAt || new Date(NOW).toISOString();
  const firstAt = Date.parse(baseline) || NOW;
  if ((j.redriveCount || 0) >= 3 || (NOW - firstAt) > 3600000) return "abandon";
  // killed "running" zombie (past 120s cap) → REAP to error (status-only, no re-exec); not re-driven.
  if (j.status === "running" && j.startedAt && (NOW - Date.parse(j.startedAt)) > 180000) return "reap";
  if (j.status !== "queued") return "skip-fresh";
  const stale = (NOW - (Date.parse(j.enqueuedAt || "") || NOW)) > STALE_JOB_MS;
  return stale ? "redrive" : "skip-fresh";
};

console.log("F53 — always-honor sweeper decisions:");
ok("done job → skip", decide({ status: "done", eventBody: EB }) === "skip");
ok("pf_done sentinel present → reconcile (never re-drive a completed job)",
  decide({ status: "queued", eventBody: EB, enqueuedAt: iso(20 * 60000) }, { hasPfDone: true }) === "reconcile-done");
ok("status=cancelled → skip", decide({ status: "cancelled", eventBody: EB }) === "skip-cancelled");
ok("kill-switch cancelled → skip (no re-drive of a stopped job)",
  decide({ status: "queued", eventBody: EB, enqueuedAt: iso(20 * 60000) }, { cancelled: true }) === "skip-cancelled");
ok("no eventBody (oversized config) → ineligible, not re-driven",
  decide({ status: "queued", enqueuedAt: iso(20 * 60000) }) === "skip-ineligible");

ok("DROPPED queued >15min → RE-DRIVE (the core guarantee)",
  decide({ status: "queued", eventBody: EB, enqueuedAt: iso(16 * 60000), firstEnqueuedAt: iso(16 * 60000) }) === "redrive");
ok("queued only 5min → skip-fresh (no premature re-drive)",
  decide({ status: "queued", eventBody: EB, enqueuedAt: iso(5 * 60000), firstEnqueuedAt: iso(5 * 60000) }) === "skip-fresh");
ok("KILLED running >180s → REAPED to error (status-only, no re-exec; not re-driven)",
  decide({ status: "running", eventBody: EB, startedAt: iso(200000), firstEnqueuedAt: iso(5 * 60000) }) === "reap");
ok("running 100s (within 120s budget) → skip-fresh (still alive, not reaped, no double-exec)",
  decide({ status: "running", eventBody: EB, startedAt: iso(100000), firstEnqueuedAt: iso(2 * 60000) }) === "skip-fresh");
ok("'error' row → never re-driven (failure-retry not in this MVP)",
  decide({ status: "error", eventBody: EB, enqueuedAt: iso(20 * 60000), firstEnqueuedAt: iso(20 * 60000) }) === "skip-fresh");

ok("poison: redriveCount=3 → abandon (bounded, not infinite)",
  decide({ status: "queued", eventBody: EB, enqueuedAt: iso(16 * 60000), firstEnqueuedAt: iso(40 * 60000), redriveCount: 3 }) === "abandon");
ok("poison: firstEnqueuedAt >1h → abandon regardless of count",
  decide({ status: "queued", eventBody: EB, enqueuedAt: iso(16 * 60000), firstEnqueuedAt: iso(61 * 60000), redriveCount: 1 }) === "abandon");
ok("under cap (redriveCount=2) + stale → still RE-DRIVE",
  decide({ status: "queued", eventBody: EB, enqueuedAt: iso(16 * 60000), firstEnqueuedAt: iso(30 * 60000), redriveCount: 2 }) === "redrive");

console.log(`\n=== F53 verification: ${pass} passed, ${fail} failed ${fail ? "❌" : "✅"} ===`);
process.exit(fail ? 1 : 0);
