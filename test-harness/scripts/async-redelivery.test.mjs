/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// THE REDELIVERY CONTRACT of the async consumer (`handler` in src/async-handler.js), run
// against the REAL module with the @forge mocks. Forge async events are at-least-once, so
// "what does a second delivery of the same taskId cost" is a product question, not a
// theoretical one. The answer asserted here was once "it costs":
//
//   F-946  A duplicate delivery RESERVES tokens in the minute's TPM bucket (the pacing gate
//          runs before the completion claim, and must — a budget DEFERRAL re-pushes the same
//          taskId, so a claim taken before the gate would refuse the re-push) and used to
//          return without releasing them. Measured 0 -> 4000 -> 8000 reserved over three
//          deliveries of ONE finished review; a redelivery burst deferred every other queued
//          AI task until the minute rolled over. The invariant: reserved is back to 0 after
//          every delivery, duplicate or not.
//
// Run: node scripts/async-redelivery.test.mjs
import { readFileSync } from "node:fs";
import "../lib/ensure-mocks.mjs";

const storage = (await import("@forge/kvs")).default;
await storage.set("COGNIRUNNER_AI_PROVIDER", "atlassian");
await storage.set("COGNIRUNNER_AI_BUDGET", { tokensPerMinute: { atlassian: 35000 } });

const idx = await import("../../src/index.js");
const ah = await import("../../src/async-handler.js");
const src = readFileSync(new URL("../../src/async-handler.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// The consumer is chatty by design (every delivery logs); keep the suite readable.
const realLog = console.log, realWarn = console.warn, realError = console.error;
const quiet = () => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => { console.log = realLog; console.warn = realWarn; console.error = realError; };

const reserved = async () => (await idx.readAiBudgetBucket("atlassian")).reserved;
const deliver = async (taskType, taskId, params = {}) => {
  // A fresh event object per delivery — exactly what the platform hands the consumer, and
  // deliberately NOT the same object twice (the long-queue mark is a WeakSet on it).
  await ah.handler({ body: { taskType, taskId, params } });
};

// ===================================================================================
// F-946 — three deliveries of ONE task leave the minute's reservation at zero.
// ===================================================================================
quiet();
const before = await reserved();
await deliver("review", "dup_review_1", { ruleId: "r1" });
const after1 = await reserved();
await deliver("review", "dup_review_1", { ruleId: "r1" });
const after2 = await reserved();
await deliver("review", "dup_review_1", { ruleId: "r1" });
const after3 = await reserved();
loud();

ok(before === 0, "the bucket starts clean");
ok(after1 === 0, "F-946: the FIRST delivery settles its own reservation (the normal path)");
ok(after2 === 0, `F-946: a DUPLICATE delivery releases what it reserved (got reserved=${after2})`);
ok(after3 === 0, `F-946: …and so does the next one — no leak accumulates (got reserved=${after3})`);

// The fix must keep ONE release site in the consumer, not two that can drift.
{
  // Two release sites exist in the file and only two: `runGatedTask`'s own fail-open catch
  // unwinds the reservation it had just taken and zeroes `budgetEstimate` so nothing
  // downstream double-releases; everything AFTER the gate returns goes through the settle.
  const releases = src.match(/bumpAiBudgetBucket\([^)]*reserved:\s*-/g) || [];
  ok(releases.length === 2, `F-946: the reservation is released in exactly two known places (found ${releases.length})`);
  const afterGate = src.slice(src.indexOf("export async function handler"));
  const handlerReleases = afterGate.match(/bumpAiBudgetBucket\([^)]*reserved:\s*-/g) || [];
  ok(handlerReleases.length === 1, `F-946: …and inside the consumer itself, exactly ONE (found ${handlerReleases.length})`);
  ok(/const settleAiBudget = async \(\) => \{/.test(src), "F-946: …and that place is the named settle both exits call");
  const dupReturn = src.match(/is a redelivery of a completed task[\s\S]{0,900}?\n {4}\}/);
  ok(!!dupReturn && /await settleAiBudget\(\);/.test(dupReturn[0]),
    "F-946: the duplicate-delivery exit leaves THROUGH the settle, not around it");
}

console.log(`async-redelivery: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
