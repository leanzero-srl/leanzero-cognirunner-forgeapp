/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// THE REDELIVERY CONTRACT of the async consumer (`handler` in src/async-handler.js), run
// against the REAL module with the @forge mocks. Forge async events are at-least-once, so
// "what does a second delivery of the same taskId cost" is a product question, not a
// theoretical one. Two answers are asserted here, both of which were once "it costs":
//
//   F-946  A duplicate delivery RESERVES tokens in the minute's TPM bucket (the pacing gate
//          runs before the completion claim, and must — a budget DEFERRAL re-pushes the same
//          taskId, so a claim taken before the gate would refuse the re-push) and used to
//          return without releasing them. Measured 0 -> 4000 -> 8000 reserved over three
//          deliveries of ONE finished review; a redelivery burst deferred every other queued
//          AI task until the minute rolled over. The invariant: reserved is back to 0 after
//          every delivery, duplicate or not.
//
//   F-947  `memory_distill` and `probe` are UNPOLLED and used to take no claim at all, so a
//          redelivery bought a second MODEL call — a second BYOK distillation, or up to
//          3 x 50k vendor-billed Forge LLM tokens for the dev probe. "Unpolled" answers
//          "is anyone waiting on a status row", never "is this free".
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

// ===================================================================================
// F-947 — every task type that spends model tokens holds a per-delivery claim, so the
// second delivery runs no model. The claim record is the observable: `task_done:<taskId>`
// exists after the first delivery, and the second delivery is answered by it.
// ===================================================================================
const claimed = async (taskId) => !!(await storage.get(`task_done:${taskId}`).catch(() => null));

for (const taskType of ["memory_distill", "probe"]) {
  const taskId = `redeliver_${taskType}_1`;
  const params = { kind: "license", name: taskId, error: "boom", codeExcerpt: "x" };
  quiet();
  await deliver(taskType, taskId, params);
  const first = await claimed(taskId);
  const jobAfterFirst = await storage.get(`async_job:${taskId}`);
  await deliver(taskType, taskId, params);
  const jobAfterSecond = await storage.get(`async_job:${taskId}`);
  loud();
  ok(first === true, `F-947: ${taskType} takes the per-delivery completion claim (it spends model tokens)`);
  // "Answer the duplicate, write nothing": the job row the first delivery finished with is
  // untouched — a second run would have stamped it back to `running` with a new startedAt.
  ok(jobAfterSecond && jobAfterFirst && jobAfterSecond.startedAt === jobAfterFirst.startedAt
     && jobAfterSecond.status === jobAfterFirst.status,
    `F-947: a redelivered ${taskType} writes nothing — the finished job row is left as it was`);
  ok(await reserved() === 0, `F-947: …and neither delivery of ${taskType} leaks a reservation`);
}

// The exemptions stay named and reasoned, never implicit: the set exists and holds exactly
// the two types whose double-spend was measured.
{
  const m = src.match(/const CLAIMED_UNPOLLED_TASKS = new Set\((\[[^\]]*\])\);/);
  ok(!!m, "F-947: CLAIMED_UNPOLLED_TASKS is a named set");
  if (m) {
    const set = new Set(JSON.parse(m[1].replace(/'/g, '"')));
    ok(set.has("memory_distill") && set.has("probe") && set.size === 2,
      "F-947: = { memory_distill, probe } — the unpolled types that call a model");
  }
  ok(/\(polled \|\| CLAIMED_UNPOLLED_TASKS\.has\(taskType\)\) && !SELF_CLAIMING_TASKS\.has\(taskType\)/.test(src),
    "F-947: the claim block reads the ONE claim decision — polled, plus the named unpolled set, minus the self-claimers");
}

// `git-event` must NOT be claimed here: it relies on the platform redelivering its taskId
// after a `requeue` throw, so a completion claim would refuse its retry.
{
  const taskId = "redeliver_git_event_1";
  quiet();
  try { await deliver("git-event", taskId, {}); } catch { /* the body may refuse offline */ }
  loud();
  ok(await claimed(taskId) === false, "F-947: git-event is still NOT claimed here — its retry depends on redelivery");
}

console.log(`async-redelivery: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
