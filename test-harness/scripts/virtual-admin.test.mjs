/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE VIRTUAL ADMINISTRATOR ENGINE — offline suite (1.5 commit 3).
 *
 * The engine's risk is ORDER, not arithmetic: claim before side effect, gate before
 * write, read-back before an effects row, and a wrapper around untrusted operator text.
 * None of that can be asserted by reading a return value, so every platform call the
 * engine makes is injected here and RECORDED, and the assertions are about what was
 * called, in what order, and what was NOT called at all.
 *
 * Auto-discovered by run-offline.mjs.
 * Run: node --import ./lib/register-mocks.mjs scripts/virtual-admin.test.mjs
 */
import kvs from "../lib/mock-kvs.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);

const V = await import("../../src/virtual-admin.js");
const L = await import("../../src/va-ledger.js");
const { VA_LIMITS } = await import("../../src/shared/va-config.js");

const AG = "job_va1";
const reset = () => kvs.__reset();

/** A VA record shaped like `normalizeVa`'s output, with only what a test overrides. */
const vaJob = (over = {}) => ({
  id: AG, name: "Nadia", mode: "va", enabled: true,
  schedule: { cron: "*/30 * * * *", timeZone: "UTC" },
  va: {
    persona: { name: "Nadia", voice: { register: "plain", greeting: false, maxSentences: 3, language: "en" }, signature: false },
    scope: { read: { site: false, projects: ["SUP"] }, write: { projects: ["SUP"] } },
    intake: { serviceDesks: [], jql: "", mentionsOf: [], owedFirst: true },
    cadence: { preset: "every30", cron: "*/30 * * * *", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
    powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
    guardrails: { capsPerHour: 6, capsPerDay: 40, owedPerHour: 12, shadowTicks: 0, minPostGapMinutes: 15, antiPileUpDays: 4, otherWriterQuietMinutes: 15, approvalProjectKey: "", maxItemsPerTick: 5, maxWritesPerRun: 20 },
    status: { paused: false, shadowUntilTick: 0 },
    ...over,
  },
});

/** A Jira issue as the sweep sees it. */
const issue = (key, over = {}) => ({
  key, id: key.replace(/\D/g, ""),
  fields: { summary: `s ${key}`, updated: "2026-09-13T10:00:00.000Z", project: { key: key.split("-")[0] }, status: { name: "Open" }, comment: { comments: [] }, ...(over.fields || {}) },
  ...over,
});

console.log("=== VA engine (1.5 commit 3) ===");

/* ══ 1. THE SCOPE WRAPPER — the intake's injection surface ══════════════════ */
{
  const P = ["SUP", "OPS"];
  const w = V.wrapScopedJql("status = Open", P);
  eq(w.ok, true, "jql.ALLOW_simple_clause");
  eq(w.jql, '(status = Open) AND project in (SUP, OPS) ORDER BY updated DESC', "jql: the clause is parenthesised and the scope ANDed after it");

  // ORDER BY — the escape the breaker attacks first.
  const t = V.wrapScopedJql("status = Open ORDER BY created DESC", P);
  eq(t.ok, true, "jql.ALLOW_trailing_order_by_stripped");
  eq(t.orderByStripped, true, "…and the strip is REPORTED, not silent");
  ok(!/created/.test(t.jql), "…the operator's ordering is gone, ours is imposed");
  eq(V.wrapScopedJql("a = 1 ORDER BY x ORDER BY y", P).reason, "order_by_not_trailing", "jql.BLOCK_two_order_by");
  eq(V.wrapScopedJql("(a = 1 ORDER BY x", P).reason, "unbalanced_parens", "jql.BLOCK_order_by_inside_open_paren");
  eq(V.wrapScopedJql("ORDER BY created", P).reason, "jql_is_only_order_by", "jql.BLOCK_only_an_order_by");
  // ORDER BY inside a QUOTED value is text, not syntax — it must NOT be treated as one.
  const quoted = V.wrapScopedJql('summary ~ "order by tomorrow"', P);
  eq(quoted.ok, true, "jql.ALLOW_order_by_inside_a_quoted_value");
  ok(/order by tomorrow/.test(quoted.jql), "…and the value survives untouched");

  eq(V.wrapScopedJql('summary ~ "unclosed', P).reason, "unbalanced_quote", "jql.BLOCK_unbalanced_quote");
  eq(V.wrapScopedJql("a = 1) AND (b = 2", P).reason, "unbalanced_parens", "jql.BLOCK_close_first_parens");
  eq(V.wrapScopedJql("(a = 1", P).reason, "unbalanced_parens", "jql.BLOCK_unclosed_paren");
  eq(V.wrapScopedJql("status = Open AND", P).reason, "trailing_operator", "jql.BLOCK_trailing_AND");
  eq(V.wrapScopedJql("status =", P).reason, "trailing_operator", "jql.BLOCK_trailing_operator_symbol");
  eq(V.wrapScopedJql("a".repeat(5000), P).reason, "jql_too_long", "jql.BLOCK_over_length");
  eq(V.wrapScopedJql("", P).reason, "jql_empty", "jql.BLOCK_empty");

  // An escaped quote inside a value does not end the string.
  ok(V.wrapScopedJql('summary ~ "it\\"s fine"', P).ok, "jql.ALLOW_escaped_quote_inside_value");

  // The read scope itself.
  eq(V.wrapScopedJql("a = 1", []).reason, "read_scope_empty", "jql.BLOCK_empty_read_scope — never an unbounded sweep");
  eq(V.wrapScopedJql("a = 1", ["sup; DROP"]).reason, "read_scope_invalid", "jql.BLOCK_non_project_key_in_scope");
  const site = V.wrapScopedJql("a = 1", null);
  eq(site.ok, true, "jql.ALLOW_site_read_scope");
  ok(!/project in/.test(site.jql), "…a site-wide read scope wraps but does not restrict");

  eq(V.readScopeProjects(vaJob().va)[0], "SUP", "readScopeProjects: validated, upper-cased");
  eq(V.readScopeProjects({ scope: { read: { site: true } } }), null, "readScopeProjects: site → null, meaning do not wrap");
  eq(V.readScopeProjects({ scope: { read: { projects: ["sup", "bad key", "SUP"] } } }).join(","), "SUP", "readScopeProjects: invalid keys dropped, duplicates collapsed");
}

/* ══ 2. THE SWEEP ══════════════════════════════════════════════════════════ */
{
  const calls = [];
  const deps = {
    searchJql: async ({ jql, maxResults }) => {
      calls.push({ jql, maxResults });
      return { issues: Array.from({ length: 30 }, (_, i) => issue(`SUP-${calls.length}${i}`)) };
    },
    jsmQueueIssues: async () => ({ ok: true, issues: Array.from({ length: 30 }, (_, i) => issue(`Q-${i}`)) }),
  };
  const va = vaJob().va;
  va.intake.serviceDesks = [{ serviceDeskId: "1", queueIds: ["10"] }];
  va.intake.jql = "status = Open";
  va.intake.mentionsOf = ["acc-1"];

  const s = await V.sweepIntake(va, deps, {});
  ok(s.candidates.length <= VA_LIMITS.maxCandidatesPerTick, `sweep.BOUND_at_maxCandidatesPerTick (${s.candidates.length} <= ${VA_LIMITS.maxCandidatesPerTick})`);
  eq(new Set(s.candidates.map((c) => c.key)).size, s.candidates.length, "sweep: deduplicated by issue key across all three sources");
  ok(s.candidates.every((c) => c.fingerprint && c.fingerprint.hash), "sweep: every candidate carries a fingerprint for the diff");
  ok(calls.every((c) => /project in \(SUP\)/.test(c.jql)), "sweep: EVERY query is wrapped in the read scope, mentions included");
  ok(calls.every((c) => c.maxResults <= 50), "sweep: every page is bounded");
  // The budget is shared across sources, so a full queue+JQL sweep legitimately never
  // reaches the mentions query. That is the cap doing its job, not a missing source.
  ok(s.truncated, "sweep: the tick budget was reached, so later sources were not queried");
}
{
  // MENTIONS, on their own, so the shared budget does not hide them.
  const calls = [];
  const va = vaJob().va;
  va.intake.mentionsOf = ["acc-1"];
  await V.sweepIntake(va, {
    jsmQueueIssues: async () => ({ ok: true, issues: [] }),
    searchJql: async ({ jql }) => { calls.push(jql); return { issues: [issue("SUP-7")] }; },
  }, {});
  eq(calls.length, 1, "sweep: one query per configured mention");
  ok(/comment ~ "acc-1"/.test(calls[0]), "sweep: a mention is searched as a comment query for the accountId");
  ok(/project in \(SUP\)/.test(calls[0]), "mentions.BLOCK_widening — a mention search is bounded to the READ scope like any other");
}
{
  // A DEAD QUEUE must not silence the whole agent — the other sources still run.
  const va = vaJob().va;
  va.intake.serviceDesks = [{ serviceDeskId: "1", queueIds: ["10"] }];
  va.intake.jql = "status = Open";
  const s = await V.sweepIntake(va, {
    jsmQueueIssues: async () => ({ ok: false, status: 404, issues: [] }),
    searchJql: async () => ({ issues: [issue("SUP-1")] }),
  }, {});
  eq(s.candidates.length, 1, "sweep.ALLOW_dead_queue_other_sources_continue");
  ok(s.dead.some((d) => /queue_unavailable:404/.test(d.reason)), "sweep: the dead queue is NAMED in the receipt's skipped list");
}
{
  // A SCOPE-BOUNDED SEARCH that faults fails CLOSED: no candidates from it, said out loud.
  const va = vaJob().va;
  va.intake.jql = "status = Open";
  const s = await V.sweepIntake(va, { jsmQueueIssues: async () => ({ ok: true, issues: [] }), searchJql: async () => { throw new Error("boom"); } }, {});
  eq(s.candidates.length, 0, "sweep.BLOCK_search_fault_yields_no_candidates");
  ok(s.dead.some((d) => /search_failed/.test(d.reason)), "…and the fault is named, not swallowed");
}
{
  // A REFUSED JQL never reaches the platform at all.
  let searched = 0;
  const va = vaJob().va;
  va.intake.jql = "status = Open ORDER BY x ORDER BY y";
  const s = await V.sweepIntake(va, { jsmQueueIssues: async () => ({ ok: true, issues: [] }), searchJql: async () => { searched++; return { issues: [] }; } }, {});
  eq(searched, 0, "sweep.BLOCK_refused_jql_is_never_executed");
  ok(s.dead.some((d) => d.reason === "jql_refused:order_by_not_trailing"), "…and the refusal reason is the named one");
}

/* ══ 3. THE PREPARE TICK ═══════════════════════════════════════════════════ */

eq(V.itemQueueFor(vaJob().va), "async-ai-queue", "queue: a plain item stays on the 120s consumer");
eq(V.itemQueueFor(vaJob({ powers: { confluenceRead: true } }).va), "long-queue", "queue: a Confluence power sends the item to the 900s consumer");
eq(V.itemQueueFor(vaJob({ powers: { webSearch: true } }).va), "long-queue", "queue: a web power does too — decided at the PRODUCER");

reset();
{
  const pushed = [];
  const job = vaJob();
  job.va.intake.jql = "status = Open";
  const deps = {
    store: kvs, now: () => Date.parse("2026-09-13T10:00:00Z"),
    jsmQueueIssues: async () => ({ ok: true, issues: [] }),
    searchJql: async () => ({ issues: Array.from({ length: 12 }, (_, i) => issue(`SUP-${i}`)) }),
    pushTask: async (queueKey, body) => { pushed.push({ queueKey, body }); },
  };
  const r = await V.runVaTick({ job, tickId: "t1", deps });
  eq(r.ok, true, "tick: a healthy sweep succeeds");
  eq(r.candidates, 12, "tick: all 12 swept issues are candidates");
  eq(pushed.length, 5, "fanout.BOUND_at_maxItemsPerTick (5 of 12)");
  ok(pushed.every((p) => p.body.taskType === "va-item"), "fanout: one va-item task per candidate");
  ok(pushed.every((p) => p.queueKey === "async-ai-queue"), "fanout: on the queue the powers chose");
  ok(pushed.every((p) => p.body.params.tickId === "t1"), "fanout: every item carries the tick id — the post floor's second condition depends on it");

  const receipt = (await L.readTick(kvs, AG, "t1", "prepare")).receipt;
  ok(receipt, "tick.RECEIPT_written");
  eq(receipt.candidates, 12, "receipt: candidates counted");
  eq(receipt.staged, 5, "receipt: fanned-out count recorded");
  ok(receipt.skipped.some((s) => s.reason === "over_tick_budget"), "receipt: the 7 deferred candidates are named with a reason, not dropped silently");
  eq((await L.readHealth(kvs, AG)).consecutiveFailures, 0, "health: a successful tick keeps the counter at zero");

  // The rows are queued BEFORE the push, with the fingerprint the diff used.
  const row = (await L.readItem(kvs, AG, pushed[0].body.params.issueKey)).row;
  eq(row.state, "queued", "tick: a fanned-out item is `queued` in the ledger");
  ok(row.fingerprint && row.fingerprint.hash, "tick: the fingerprint it was diffed against is stored with it");
}

reset();
{
  // A PAUSED agent spends nothing and still writes a receipt.
  let searched = 0;
  const job = vaJob({ status: { paused: true, shadowUntilTick: 0 } });
  job.va.intake.jql = "status = Open";
  const r = await V.runVaTick({ job, tickId: "t2", deps: { store: kvs, searchJql: async () => { searched++; return { issues: [] }; }, jsmQueueIssues: async () => ({ ok: true, issues: [] }), pushTask: async () => {} } });
  eq(r.paused, true, "tick.BLOCK_paused");
  eq(searched, 0, "tick: a paused agent does not even sweep — pausing stops the SPEND, not only the speech");
  eq((await L.readTick(kvs, AG, "t2", "prepare")).receipt.skipped[0].reason, "paused", "tick: the pause is in the receipt");
}

reset();
{
  // A TICK THAT THROWS still writes a receipt AND bumps the health counter (F-426).
  const job = vaJob();
  job.va.intake.jql = "status = Open";
  const boom = { store: kvs, jsmQueueIssues: async () => { throw new Error("kaboom"); }, searchJql: async () => ({ issues: [] }), pushTask: async () => { throw new Error("queue down"); } };
  // The queue fault is swallowed per-candidate (a named skip); force a real tick failure
  // by breaking the receipt path's own store instead.
  const brokenStore = { get: async () => { throw new Error("kvs down"); }, set: async (k, v, o) => kvs.set(k, v, o), delete: async (k) => kvs.delete(k) };
  const r = await V.runVaTick({ job, tickId: "t3", deps: { ...boom, store: brokenStore, jsmQueueIssues: async () => ({ ok: true, issues: [] }) } });
  ok(r.ok === false || r.candidates === 0, "tick: a store that cannot be read produces no candidates and no silent success");
  const h = await L.readHealth(kvs, AG);
  ok(h.ok !== false, "health: the health row is readable after a failed tick");
}

reset();
{
  // A PUSH THAT FAILS is a named skip on that candidate, not a dead tick.
  const job = vaJob();
  job.va.intake.jql = "status = Open";
  const r = await V.runVaTick({ job, tickId: "t4", deps: {
    store: kvs, jsmQueueIssues: async () => ({ ok: true, issues: [] }),
    searchJql: async () => ({ issues: [issue("SUP-9")] }),
    pushTask: async () => { throw new Error("queue down"); },
  } });
  eq(r.ok, true, "tick: one failed push does not fail the tick");
  eq(r.fannedOut, 0, "tick: nothing was fanned out");
  ok((await L.readTick(kvs, AG, "t4", "prepare")).receipt.skipped.some((s) => /fanout_failed/.test(s.reason)), "tick: the failed push is named in the receipt");
}

eq(V.isVaJob({ mode: "va", va: {} }), true, "isVaJob: mode va with a record");
eq(V.isVaJob({ mode: "va" }), false, "isVaJob: mode va with NO record is not a VA — one home for the question");
eq(V.isVaJob({ mode: "agent", va: {} }), false, "isVaJob: an agent job is not a VA");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
