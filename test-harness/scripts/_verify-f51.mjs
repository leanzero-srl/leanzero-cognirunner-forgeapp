/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Deterministic unit check for the F51 (hunt-6) fix: api.log() is bounded so a runaway
// log loop can't grow executionLogs without limit (OOM). Copies the FIXED log() logic.

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}`); } };

const MAX_EXEC_LOGS = 5000;
const makeLog = (executionLogs) => (...args) => {
  if (executionLogs.length >= MAX_EXEC_LOGS) {
    if (executionLogs.length === MAX_EXEC_LOGS) executionLogs.push(`[api.log output capped at ${MAX_EXEC_LOGS} entries — further log() calls suppressed to protect the function from running out of memory]`);
    return;
  }
  const msg = args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  executionLogs.push(msg.length > 4000 ? msg.slice(0, 4000) + "…[truncated]" : msg);
};

console.log("Fix — api.log() bounded (count cap + per-message truncation):");
const logs = [];
const log = makeLog(logs);
for (let i = 0; i < 1_000_000; i++) log(i); // simulated runaway loop
ok("1M log() calls → array bounded (not 1M entries)", logs.length === MAX_EXEC_LOGS + 1);
ok("exactly one 'capped' notice appended", logs.filter((l) => l.includes("capped at")).length === 1);
ok("cap notice is the last entry", logs[logs.length - 1].includes("capped at"));

const logs2 = [];
makeLog(logs2)("x".repeat(50000)); // single huge message
ok("single huge message → truncated to ~4000 chars", logs2[0].length <= 4100 && logs2[0].endsWith("…[truncated]"));

const logs3 = [];
const log3 = makeLog(logs3);
log3("hello", { a: 1 }); log3("world");
ok("normal usage unaffected — messages stored verbatim", logs3.length === 2 && logs3[0] === 'hello {"a":1}' && logs3[1] === "world");

console.log(`\n=== F51 verification: ${pass} passed, ${fail} failed ${fail ? "❌" : "✅"} ===`);
process.exit(fail ? 1 : 0);
