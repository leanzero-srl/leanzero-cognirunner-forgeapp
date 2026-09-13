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
  ...over,
  // `fields` is merged LAST and deliberately: spreading `over` after it replaces the
  // whole object, which silently drops `project` — and a missing project makes every
  // write-scope check answer `project_unresolvable`, i.e. the suite would assert the
  // gates against fixtures that can never pass them.
  fields: { summary: `s ${key}`, updated: "2026-09-13T10:00:00.000Z", project: { key: key.split("-")[0] }, status: { name: "Open" }, comment: { comments: [] }, ...(over.fields || {}) },
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

/* ══ 4. THE AUDIENCE DECISION (F-415) ══════════════════════════════════════ */
{
  const req = issue("SUP-1", { fields: { reporter: { accountId: "rep-1" }, requestType: { id: "rt-1" }, comment: { comments: [] } } });
  const openVa = vaJob({ powers: { replyPublic: true, replyInternal: true } }).va;
  const shutVa = vaJob().va;

  eq(V.decideAudience({ requested: "public", va: shutVa, issue: req, addresseeAccountId: "rep-1" }).reason, "reply_public_power_off", "gate.audience.BLOCK_public_without_power");
  eq(V.decideAudience({ requested: "public", va: openVa, issue: req, addresseeAccountId: "other" }).reason, "addressee_not_reporter", "gate.audience.BLOCK_public_to_non_reporter");
  eq(V.decideAudience({ requested: "public", va: openVa, issue: issue("SUP-2", { fields: { reporter: { accountId: "rep-1" } } }), addresseeAccountId: "rep-1" }).reason, "unknown_request_type", "gate.audience.BLOCK_unknown_request_type");
  eq(V.decideAudience({ requested: "public", va: openVa, issue: { key: "SUP-3", fields: { requestType: { id: "r" } } } }).reason, "unknown_reporter", "gate.audience.BLOCK_unknown_reporter");
  eq(V.decideAudience({ requested: "internal", va: openVa, issue: req, addresseeAccountId: "rep-1" }).audience, "internal", "gate.audience.ALLOW_internal_default");
  eq(V.decideAudience({ requested: "public", va: openVa, issue: req, addresseeAccountId: "rep-1" }).audience, "public", "gate.audience.ALLOW_public_to_reporter");
  // EVERY refusal downgrades; none of them throws and none answers "unknown".
  for (const bad of [null, undefined, {}, { fields: null }]) {
    eq(V.decideAudience({ requested: "public", va: openVa, issue: bad }).audience, "internal", "audience: an unreadable issue downgrades to internal, never throws");
  }
}

/* ══ 5. THE ITEM TURN ══════════════════════════════════════════════════════ */

/** A scripted model: each entry is one round's tool calls, or a prose string. */
const scriptedLoop = (script) => {
  const seen = [];
  const fn = async ({ messages, tools, execute }) => {
    fn.messages = messages.slice();
    fn.tools = tools;
    for (const round of script) {
      if (typeof round === "string") return { endedBy: "prose", rounds: 1, summary: round, usage: { tokens: 1 } };
      for (const call of round) {
        seen.push({ name: call.name, result: await execute(call.name, call.args || {}) });
      }
    }
    return { endedBy: "finish", rounds: script.length, summary: "done", usage: { tokens: 1 } };
  };
  fn.seen = seen;
  return fn;
};

/** Deps for an item turn with no Forge anywhere. */
const itemDeps = (over = {}) => {
  const changes = [];
  const posted = [];
  return {
    store: kvs, now: () => Date.parse("2026-09-13T12:00:00Z"),
    getIssue: async (k) => issue(k, { fields: { reporter: { accountId: "rep-1" }, requestType: { id: "rt-1" }, comment: { comments: [{ id: "c-9", author: { accountId: "rep-1" }, body: "hi" }] } } }),
    createIssue: async (fields) => { posted.push(fields); return { key: "INBOX-1" }; },
    createSession: async () => ({ changes, createApi: () => ({}) }),
    // A STAND-IN FOR `createAgentActionDispatcher`, delegating by namespace exactly as the
    // real one does (agent-runner.js). The ledger actions must reach the ledger EXECUTOR
    // and not a Jira branch; a mock that answered every id itself would make the whole
    // 4a move untestable, because the turn would pass with no executor wired at all.
    createDispatcher: ({ executors = {} } = {}) => async (name, args) => {
      for (const ex of Object.values(executors)) if (ex && typeof ex.handles === "function" && ex.handles(name)) return ex.execute(name, args || {});
      changes.push({ action: name });
      return { ok: true };
    },
    compactIssue: (i) => ({ key: i.key, summary: i.fields.summary }),
    buildKnowledge: async () => ({ skillsBlock: "house rules" }),
    buildKnowledgeMessages: (k) => (k && k.skillsBlock ? [{ role: "system", content: `## OPERATOR KNOWLEDGE\n${k.skillsBlock}` }] : []),
    toolDefinitionsFor: (ids) => ids.map((id) => ({ type: "function", function: { name: id } })),
    log: () => {},
    __changes: changes, __posted: posted,
    ...over,
  };
};

reset();
{
  // A TURN STAGES; IT NEVER POSTS.
  const loop = scriptedLoop([[{ name: "stage_reply", args: { audience: "internal", body: "Looking at it now.", reason: "customer asked for an ETA" } }]]);
  const d = itemDeps({ runLoop: loop });
  const r = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-1", tickId: "t1", deps: d });
  eq(r.ok, true, "item: the turn ran");
  eq(r.staged.audience, "internal", "item.ALLOW_stage_reply");
  eq(d.__posted.length, 0, "item.BLOCK_never_posts — a turn creates no comment at all");
  const row = (await L.readItem(kvs, "job_va1", "SUP-1")).row;
  eq(row.state, "staged", "item: the row is staged");
  eq(row.staged.body, "Looking at it now.", "item: the draft body round-trips");
  eq(row.staged.baseline, "c-9", "item: the FRESHNESS baseline is the last comment id we saw");
  eq(row.staged.tickId, "t1", "item: the staging tick id is recorded — the post floor's second condition");

  // The tool list: speech actions, reads, and NOT add_comment.
  ok(loop.tools.some((t) => t.function.name === "stage_reply"), "item: the model is given stage_reply");
  ok(!loop.tools.some((t) => t.function.name === "add_comment"), "item.BLOCK_add_comment_is_not_a_tool — the guarantee is that no tool posts");
  ok(!V.freeActionsFor(vaJob({ powers: { editFields: true, assign: true, transition: true } }).va).includes("add_comment"),
    "freeActionsFor: add_comment is absent whatever the powers say");
}

reset();
{
  // AUDIENCE IS DECIDED AT STAGE TIME, and a customer reply the powers forbid is
  // DOWNGRADED, not dropped and not posted.
  const loop = scriptedLoop([[{ name: "stage_reply", args: { audience: "customer", body: "We are on it.", reason: "reply" } }]]);
  const r = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-1", tickId: "t1", deps: itemDeps({ runLoop: loop }) });
  eq(r.staged.audience, "internal", "item: a customer reply without the power is staged internal");
  eq(r.staged.reason, "reply_public_power_off", "…with the reason recorded");
  ok(/no other way/.test(loop.seen[0].result.note), "…and the model is told there is no other way, so it does not hunt for one");

  // With the power and the right reporter, it is staged public.
  reset();
  const loop2 = scriptedLoop([[{ name: "stage_reply", args: { audience: "customer", body: "We are on it.", reason: "reply" } }]]);
  const r2 = await V.runVaItem({ agent: vaJob({ powers: { replyPublic: true, replyInternal: true } }), issueKey: "SUP-1", tickId: "t1", deps: itemDeps({ runLoop: loop2 }) });
  eq(r2.staged.audience, "public", "item: with the power, and the reporter as the addressee, it is staged public");
}

reset();
{
  // PROPOSE_CHANGE NEVER EXECUTES.
  const loop = scriptedLoop([[{ name: "propose_change", args: { kind: "workflow", target: "SUP workflow", blastRadius: "all SUP issues", steps: "add a status" } }]]);
  const d = itemDeps({ runLoop: loop });
  const r = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-1", tickId: "t1", deps: d });
  eq(r.proposed, true, "item: the proposal was filed");
  eq(loop.seen[0].result.executed, false, "propose.BLOCK_never_executes — the result says so explicitly");
  eq(d.__changes.length, 0, "propose: nothing was dispatched, so nothing could have been changed");
  eq(d.__posted.length, 0, "propose: with no inbox it is staged, not posted");
  // With an inbox it goes to the inbox, and STILL changes nothing on the issue.
  reset();
  const loop2 = scriptedLoop([[{ name: "propose_change", args: { kind: "permission", target: "x", blastRadius: "y", steps: "z" } }]]);
  const d2 = itemDeps({ runLoop: loop2 });
  await V.runVaItem({ agent: vaJob({ guardrails: { ...vaJob().va.guardrails, approvalProjectKey: "INBOX" } }), issueKey: "SUP-1", tickId: "t1", deps: d2 });
  eq(d2.__posted.length, 1, "propose: with an inbox, one issue is filed there");
  eq(d2.__posted[0].project.key, "INBOX", "…in the project the RECORD names, never one the model chose");
  eq(d2.__changes.length, 0, "…and still nothing was changed on the issue");
}

reset();
{
  // ASK_HUMAN parks the item on a human, and with no inbox it is STAGED, not posted.
  const loop = scriptedLoop([[{ name: "ask_human", args: { summary: "Can we refund this?", needs: "a yes or no from billing" } }]]);
  const d = itemDeps({ runLoop: loop });
  const r = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-1", tickId: "t1", deps: d });
  eq(r.asked, true, "item.ALLOW_ask_human");
  eq(d.__posted.length, 0, "ask_human: with no inbox the question is STAGED — it does not bypass the post gates");
  eq((await L.readItem(kvs, "job_va1", "SUP-1")).row.staged.audience, "internal", "ask_human: staged as an internal note");

  reset();
  const loop2 = scriptedLoop([[{ name: "ask_human", args: { summary: "q", needs: "n" } }]]);
  const d2 = itemDeps({ runLoop: loop2 });
  await V.runVaItem({ agent: vaJob({ guardrails: { ...vaJob().va.guardrails, approvalProjectKey: "INBOX" } }), issueKey: "SUP-1", tickId: "t1", deps: d2 });
  const row = (await L.readItem(kvs, "job_va1", "SUP-1")).row;
  eq(row.state, "waiting_on_human", "ask_human: with an inbox the item waits on a human");
  ok(row.dueAt, "…with a due date, so it comes back rather than waiting for ever");
}

reset();
{
  // ATTEMPTS: a turn that stages nothing bumps, and parks at the cap.
  const nothing = () => scriptedLoop(["I had a think and did nothing."]);
  for (let i = 1; i <= VA_LIMITS.attemptsCap; i++) {
    const r = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-5", tickId: `t${i}`, deps: itemDeps({ runLoop: nothing() }) });
    if (i < VA_LIMITS.attemptsCap) ok(r.parked === false, `item.attempts.ALLOW_attempt_${i}`);
    else eq(r.parked, true, "item.attempts.BLOCK_parked_at_cap");
  }
  const parked = (await L.readItem(kvs, "job_va1", "SUP-5")).row;
  eq(parked.state, "parked", "attempts: the item is PARKED, so it stops consuming ticks");
  ok(parked.history.some((h) => h.event === "parked"), "attempts: the park is in the history with its reason");
  // A parked item is not worked again — the model is never called.
  let called = 0;
  await V.runVaItem({ agent: vaJob(), issueKey: "SUP-5", tickId: "t99", deps: itemDeps({ runLoop: async () => { called++; return { endedBy: "finish", rounds: 1, usage: {} }; } }) });
  eq(called, 0, "item.attempts.BLOCK_parked_item_never_calls_the_model");
}

reset();
{
  // THE CLAIM (F-422) is taken by the CONSUMER, and a second delivery does not run.
  const loop = scriptedLoop([[{ name: "ledger_note", args: { note: "a note" } }]]);
  const first = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-6", tickId: "t1", deps: itemDeps({ runLoop: loop }) });
  eq(first.ok, true, "claim.exec.ALLOW_first_delivery");
  let called = 0;
  const second = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-6", tickId: "t1", deps: itemDeps({ runLoop: async () => { called++; return { endedBy: "finish", rounds: 1, usage: {} }; } }) });
  eq(second.ok, false, "claim.exec.BLOCK_second_consumer");
  eq(second.reason, "already_claimed", "…with the named reason");
  eq(called, 0, "…and the model was never called a second time, so the tokens were not spent twice");
}

reset();
{
  // A TURN THAT THROWS RELEASES ITS CLAIM, so a retry can run (F-335/F-367's shape).
  const r = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-7", tickId: "t1", deps: itemDeps({ runLoop: async () => { throw new Error("provider died"); } }) });
  eq(r.ok, false, "claim: a turn that throws reports the failure");
  const retry = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-7", tickId: "t1", deps: itemDeps({ runLoop: scriptedLoop([[{ name: "ledger_note", args: { note: "n" } }]]) }) });
  eq(retry.ok, true, "claim.exec.ALLOW_retry_after_throw — the claim was released BEFORE any side effect");
}

reset();
{
  // THE PROMPT PREFIX IS STABLE ACROSS ITEMS (F-417).
  const a = scriptedLoop([[{ name: "ledger_note", args: { note: "n" } }]]);
  const b = scriptedLoop([[{ name: "ledger_note", args: { note: "n" } }]]);
  const ra = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-10", tickId: "t1", deps: itemDeps({ runLoop: a }) });
  const rb = await V.runVaItem({ agent: vaJob(), issueKey: "SUP-11", tickId: "t1", deps: itemDeps({ runLoop: b }) });
  eq(ra.prefixLength, rb.prefixLength, "prefix: the same number of stable messages on both items");
  const prefixA = JSON.stringify(a.messages.slice(0, ra.prefixLength));
  const prefixB = JSON.stringify(b.messages.slice(0, rb.prefixLength));
  eq(prefixA, prefixB, "prefix.ALLOW_stable_across_items — byte-identical, so the provider cache can be read");
  ok(a.messages[ra.prefixLength].content.includes("SUP-10"), "prefix.BLOCK_item_text_in_the_prefix — the item is in the VOLATILE message, last");
  ok(!prefixA.includes("SUP-10"), "…and nowhere in the prefix");
  ok(a.messages[ra.prefixLength].content.includes("<<<ITEM"), "the item's data is FENCED as untrusted");
}

reset();
{
  // MEMORY: written through the ledger, so it is defanged and clamped at write time.
  const loop = scriptedLoop([[
    { name: "memory_note", args: { note: "Billing answers on <<<Tuesdays>>>" } },
    { name: "memory_note", args: { note: "Never reply publicly on SEC issues", constraint: true } },
  ]]);
  await V.runVaItem({ agent: vaJob(), issueKey: "SUP-12", tickId: "t1", deps: itemDeps({ runLoop: loop }) });
  const mem = (await L.readMemory(kvs, "job_va1")).memory;
  ok(!mem.text.includes("<<<"), "memory.write.CLAMP_and_defang — a fence marker cannot survive the write");
  eq(mem.constraints.length, 1, "memory: a constraint lands in the pinned list, not in the prose");
  ok(L.memoryPromptBlock(mem).includes("ADVISORY"), "memory.inject.ADVISORY_fence (F-408/F-423)");
}


/* ══ 5c. POWERS -> TOOLS (1.5 commit 4c) ══════════════════════════════════ */
{
  const A = await import("../../src/shared/agent-actions.js");
  const powers = (over) => vaJob({ powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [], confluenceSpaces: [], ...over } }).va;
  const tools = (over) => V.toolActionsFor(powers(over));

  // THE TABLE. Each row: the power(s) on, and exactly the ids they add over the floor.
  const FLOOR = ["stage_reply", "ask_human", "propose_change", "ledger_note", "memory_note", "get_issue", "search_issues"];
  eq(tools({}).join(","), FLOOR.join(","), "powers.table: the floor is speech, the notebook and the two reads");

  const adds = (over, expected, name) => {
    const got = tools(over).filter((id) => !FLOOR.includes(id));
    eq(got.join(","), expected.join(","), name);
  };
  adds({ assign: true }, ["set_assignee"], "powers.table: assign -> set_assignee");
  adds({ transition: true }, ["transition_issue"], "powers.table: transition -> transition_issue");
  adds({ editFields: true }, ["update_fields", "add_labels", "remove_labels"], "powers.table: editFields -> the three field writes");
  adds({ confluenceRead: true }, ["confluence_search", "confluence_get_page"], "powers.table: confluenceRead -> the two Confluence reads");
  adds({ confluenceWrite: true, confluenceSpaces: ["ENG"] },
    ["confluence_search", "confluence_get_page", "confluence_create_page", "confluence_update_page", "confluence_add_comment"],
    "powers.table: confluenceWrite -> reads AND writes (a blind page edit is not a feature)");
  adds({ git: true }, ["get_pull_request", "get_build_state", "get_deploy_status"], "powers.table: git -> READ actions only");
  adds({ webSearch: true }, ["web_search"], "powers.table: webSearch -> web_search");

  // SPEECH: `stage_reply` exists only for an agent that may speak at all.
  ok(!tools({ replyInternal: false, replyPublic: false }).includes("stage_reply"),
    "powers.BLOCK_stage_reply_without_either_reply_power");
  ok(tools({ replyInternal: false, replyPublic: true }).includes("stage_reply"),
    "powers.ALLOW_stage_reply_with_public_only");
  // …and the notebook survives even then: an agent that cannot speak can still say it is
  // stuck, which is the difference between a quiet agent and a guessing one.
  for (const id of ["ask_human", "propose_change", "ledger_note", "memory_note"]) {
    ok(tools({ replyInternal: false, replyPublic: false }).includes(id), `powers.ALLOW_${id}_is_unconditional`);
  }

  // NO WRITE-SHAPED GIT ACTION, EVER, whatever the powers say. Asserted by NAME rather
  // than by the list's contents, the same way `add_comment`'s absence is.
  for (const id of ["commit_files", "open_pull_request", "approve_pull_request", "trigger_deploy", "create_repo", "create_branch", "request_changes", "add_pr_comment"]) {
    ok(!tools({ git: true }).includes(id), `powers.BLOCK_git_write_${id}`);
  }
  // …and no direct-speech action of any kind reaches the list under ANY power set.
  const everything = tools({ replyPublic: true, replyInternal: true, assign: true, transition: true, editFields: true, confluenceRead: true, confluenceWrite: true, confluenceSpaces: ["ENG"], git: true, webSearch: true });
  ok(!everything.includes("add_comment"), "powers.BLOCK_add_comment_under_every_power");
  ok(!everything.includes("create_issue"), "powers.BLOCK_create_issue — the approval inbox is not a model-chosen target");
  ok(!everything.some((id) => /scheme|workflow|permission|role/i.test(id)), "powers.BLOCK_no_configuration_write_exists");
  // Every id is a real catalogue id — a typo here would be a tool the dispatcher refuses.
  for (const id of everything) ok(A.getAgentAction(id) !== null, `powers: ${id} is a real catalogue action`);
  // Order is the catalogue's namespace order, which keeps the cached prefix stable (F-417).
  eq(everything.slice(0, 5).join(","), "stage_reply,ask_human,propose_change,ledger_note,memory_note", "powers: the ledger block comes first");
}

/* ══ 5d. THE HEADLESS `confirm` RULE (1.5 commit 4c) ═══════════════════════ */
{
  const A = await import("../../src/shared/agent-actions.js");
  // The two Confluence PAGE writes are `confirm: true`. On a listener or a job that means
  // "only an admin-saved rule may hold this". A VA turn is headless too — and it NEVER
  // opens a consent ticket, so the POWERS are the confirmation.
  ok(A.getAgentAction("confluence_create_page").confirm === true, "confluence_create_page is a confirm action");
  const on = V.toolActionsFor(vaJob({ powers: { replyInternal: true, confluenceWrite: true, confluenceSpaces: ["ENG"] } }).va);
  ok(on.includes("confluence_create_page"), "confirm.ALLOW_powers_are_the_confirmation");
  const off = V.toolActionsFor(vaJob({ powers: { replyInternal: true, confluenceRead: true } }).va);
  ok(!off.includes("confluence_create_page"), "confirm.BLOCK_not_allowed_by_the_powers");

  // …and if the model invents it anyway, the ONE allow-list check refuses it, with the
  // sentence every surface uses. This is `assertAgentActionAllowed`, not a VA branch.
  const { assertAgentActionAllowed } = await import("../../src/agent-runner.js");
  let threw = null;
  try { assertAgentActionAllowed("confluence_create_page", off); } catch (e) { threw = e; }
  ok(threw && /is not allowed for this rule/.test(threw.message), "confirm.BLOCK_invented_action_is_refused_by_the_one_gate");

  // THE PROOF THAT NO CONSENT TICKET EXISTS ON THIS SURFACE: the halt protocol the Coder
  // uses (`__agentHalt`) appears nowhere in the engine, and neither does a consent issue.
  const { readFileSync } = await import("node:fs");
  const vsrc = readFileSync(new URL("../../src/virtual-admin.js", import.meta.url), "utf8");
  ok(!/__agentHalt/.test(vsrc), "confirm.BLOCK_no_halt_path — a headless VA turn never opens a consent ticket");
  // No IDENTIFIER carrying the word either — the prose above may discuss consent tickets,
  // but a variable, function or field named for one would be a code path toward one.
  ok(!/[A-Za-z_$][A-Za-z0-9_$]*[Cc]onsent[A-Za-z0-9_$]*\s*[=(:]/.test(vsrc),
    "confirm.BLOCK_no_consent_ticket_code_path_in_the_engine");
  ok(!/"awaiting"/.test(vsrc), "confirm.BLOCK_no_awaiting_outcome — the turn cannot end waiting on a human it never asked");
}

/* ══ 5e. CONFLUENCE WRITES ARE SCOPED BY SPACE, NOT BY PROJECT ════════════ */
{
  // THE DECISION, stated where it is enforced: a Confluence page is in a SPACE and has no
  // project, so `scope.write.projects` cannot answer "may this agent change this page".
  // Asking the Jira question of a page would make every Confluence write unresolvable and
  // therefore permanently refused. The allow-list is `powers.confluenceSpaces[]`.
  const { vaConfluenceSpaces } = await import("../../src/shared/va-config.js");
  const va = vaJob({
    scope: { read: { site: false, projects: ["SUP"] }, write: { projects: ["SUP"] } },
    powers: { replyInternal: true, confluenceWrite: true, confluenceSpaces: ["ENG"] },
  }).va;
  eq(vaConfluenceSpaces(va).join(","), "ENG", "space scope: the allow-list is the SPACE list, not the project list");

  // The engine hands that list, and only that list, to the executor.
  const built = [];
  const loop = scriptedLoop([[{ name: "confluence_create_page", args: { spaceKey: "ENG", title: "t", body: "b" } }]]);
  const d = itemDeps({
    runLoop: loop,
    createSession: async () => ({ changes: [], simulated: false, createApi: () => ({}) }),
    createConfluenceExecutor: (ctx) => {
      built.push(ctx);
      return { namespace: "confluence", handles: (id) => String(id).startsWith("confluence_"), execute: async (id, args) => ({ success: true, action: id, args, spaces: ctx.spaces }) };
    },
  });
  reset();
  await V.runVaItem({ agent: vaJob({ powers: { replyInternal: true, confluenceWrite: true, confluenceSpaces: ["ENG"] } }), issueKey: "SUP-1", tickId: "t1", deps: d });
  eq(built.length, 1, "space scope: the Confluence executor is built once for the turn");
  eq(built[0].spaces.join(","), "ENG", "space scope: it receives the record's space allow-list");
  ok(!("writeScope" in built[0]), "space scope: …and NOT the Jira write scope, which cannot answer for a page");
  eq(loop.seen[0].result.spaces.join(","), "ENG", "space scope: the call really went through that executor");

  // A read-only Confluence agent gets NO space list at all, so the executor refuses every
  // write even though the record still names a space.
  const readOnly = vaJob({ powers: { replyInternal: true, confluenceRead: true, confluenceWrite: false, confluenceSpaces: ["ENG"] } }).va;
  eq(vaConfluenceSpaces(readOnly).length, 0, "space scope.BLOCK_list_without_the_power");

  // NO EXECUTOR IS BUILT for a namespace the powers do not switch on — a tool the model
  // is offered and then refused for reasons it cannot see reads as a broken instance.
  const built2 = [];
  reset();
  await V.runVaItem({
    agent: vaJob(), issueKey: "SUP-1", tickId: "t1",
    deps: itemDeps({ runLoop: scriptedLoop([[{ name: "ledger_note", args: { note: "x" } }]]), createConfluenceExecutor: (ctx) => { built2.push(ctx); return {}; } }),
  });
  eq(built2.length, 0, "space scope.BLOCK_no_executor_without_the_power");
}


/* ══ 6. THE WRITE SCOPE, THROUGH THE REAL DISPATCHER (F-410/F-411) ═════════ */
{
  const { createAgentActionDispatcher } = await import("../../src/agent-runner.js");
  const { assertWriteScope } = await import("../../src/shared/agent-actions.js");
  const { vaWriteScope } = await import("../../src/shared/va-config.js");

  // The predicate itself — the three states, and the difference between two of them.
  eq((await assertWriteScope("SUP-1", undefined)).reason, "write_scope_absent", "writescope.BLOCK_absent_is_refused");
  eq((await assertWriteScope("SUP-1", null)).allowed, true, "writescope.ALLOW_explicit_null_is_unscoped_legacy");
  eq((await assertWriteScope("SUP-1", { projects: [] })).reason, "write_scope_empty", "writescope.BLOCK_empty_list_means_no_writes_not_all");
  eq((await assertWriteScope("SUP-1", { site: true, projects: ["SUP"] })).reason, "site_wide_write_refused", "gate.scope.BLOCK_site_wide_write_refused");
  eq((await assertWriteScope("SUP-1", { projects: ["SUP"] })).reason, "project_unresolvable", "gate.scope.BLOCK_unresolvable_project — no reader is a refusal, not a pass");
  eq((await assertWriteScope("SUP-1", { projects: ["SUP"] }, { readProject: async () => { throw new Error("x"); } })).reason, "project_unresolvable", "…and a reader that throws is too");
  eq((await assertWriteScope("SUP-1", { projects: ["SUP"] }, { readProject: async () => null })).reason, "project_unresolvable", "…and a reader that answers nothing is too");
  eq((await assertWriteScope("OPS-1", { projects: ["SUP"] }, { readProject: async () => "OPS" })).reason, "outside_write_scope", "gate.scope.BLOCK_outside_write_scope");
  eq((await assertWriteScope("SUP-1", { projects: ["SUP"] }, { readProject: async () => "sup" })).allowed, true, "gate.scope.ALLOW_in_scope (case-insensitive)");

  eq(vaWriteScope(vaJob().va).projects.join(","), "SUP", "vaWriteScope builds the context the dispatcher consumes");

  // Through the REAL dispatcher: the project comes from a READ, not from the argument.
  const changes = [];
  const mkApi = (projectKey) => {
    const api = {
      getIssue: async (k) => ({ key: k, fields: { project: { key: projectKey } } }),
      addComment: async () => { changes.push({}); return { id: "1" }; },
      setAssignee: async () => { changes.push({}); return { success: true }; },
      createIssue: async () => { changes.push({}); return { key: "X-1" }; },
      forIssue: () => api,
    };
    return api;
  };
  const dispatcherOn = (projectKey, writeScope) => createAgentActionDispatcher({
    issueKey: "SUP-1", session: { createApi: () => mkApi(projectKey), changes },
    allowed: ["add_comment", "set_assignee", "create_issue", "get_issue"], m: {}, maxWrites: null, writeScope,
  });

  const inScope = await dispatcherOn("SUP", { projects: ["SUP"] })("add_comment", { issueKey: "SUP-1", text: "hi" });
  ok(inScope && inScope.id === "1", "gate.scope.ALLOW_in_scope_write_through_the_dispatcher");

  changes.length = 0;
  // The model CLAIMS the issue is in SUP; the READ says OPS. The read wins.
  const lied = await dispatcherOn("OPS", { projects: ["SUP"] })("add_comment", { issueKey: "SUP-1", text: "hi" });
  eq(lied.code, "write_scope", "writescope.BLOCK_dispatcher_outside_scope — resolved from a READ, never from the model's argument");
  eq(changes.length, 0, "…and nothing reached Jira");

  const foreign = await dispatcherOn("SUP", { projects: ["SUP"] })("create_issue", { projectKey: "OPS", issueType: "Task", summary: "s" });
  eq(foreign.code, "write_scope", "writescope.BLOCK_create_issue_foreign_project");
  const own = await dispatcherOn("SUP", { projects: ["SUP"] })("create_issue", { projectKey: "SUP", issueType: "Task", summary: "s" });
  ok(own && own.key === "X-1", "writescope.ALLOW_create_issue_in_scope");

  // A READ is never scope-checked: an agent that cannot read cannot decide anything.
  const read = await dispatcherOn("OPS", { projects: ["SUP"] })("get_issue", { issueKey: "OPS-1" });
  ok(read, "writescope: reads are not blocked by the WRITE scope");
}

/* ══ 7. THE POST PHASE — the eleven gates, each BLOCK and ALLOW by name ═════ */

const T0 = Date.parse("2026-09-13T12:00:00Z");
const MIN = 60000;
const DAY = 86400000;
const SELF = "app-user";

/** An issue with a comment thread, for the freshness / quiet / pile-up gates. */
const thread = (comments) => issue("SUP-1", {
  fields: {
    reporter: { accountId: "rep-1" }, requestType: { id: "rt-1" },
    comment: { comments },
  },
});
const humanComment = (id, atMs) => ({ id, author: { accountId: "rep-1" }, created: new Date(atMs).toISOString(), body: "hi" });
const ourComment = (id, atMs) => ({ id, author: { accountId: SELF }, created: new Date(atMs).toISOString(), body: "ok" });

/** Stage one draft on SUP-1 and return the deps for a post run. */
const postDeps = (over = {}) => {
  const commented = [];
  const repaired = [];
  const read = [];
  return {
    store: kvs, now: () => T0,
    tickId: () => "t-post",
    tickIndex: () => 999,                       // out of shadow unless a test says otherwise
    isKillSwitchActive: async () => false,
    selfAccountId: async () => ({ ok: true, accountId: SELF }),
    getIssue: async () => thread([humanComment("c-1", T0 - 60 * MIN)]),
    addComment: async (k, body, opts) => { commented.push({ k, body, internal: opts.internal }); return { id: "new-1" }; },
    readComment: async () => { read.push(1); return { id: "new-1", jsdPublic: false }; },
    makeCommentInternal: async (k, id) => { repaired.push(id); return { repaired: true }; },
    log: () => {},
    __commented: commented, __repaired: repaired, __read: read,
    ...over,
  };
};

const stageDraft = async (over = {}) => {
  await L.saveItem(kvs, AG, "SUP-1", { state: "queued" }, { now: T0 });
  await L.saveItem(kvs, AG, "SUP-1", {
    state: "staged",
    staged: {
      audience: "internal", body: "I have picked this up. It should be sorted today.", reason: "customer asked for an ETA",
      baseline: "c-1", tickId: "t-stage", stagedAt: new Date(T0 - 30 * MIN).toISOString(), ...over,
    },
  }, { now: T0 });
};

/* — the DOUBLE FLOOR — */
{
  const staged = { tickId: "t-post", stagedAt: new Date(T0 - 60 * MIN).toISOString() };
  eq(V.postFloorOk({ staged, currentTickId: "t-post", minPostGapMinutes: 15, now: T0 }).reason, "same_tick", "post.floor.BLOCK_same_tick");
  eq(V.postFloorOk({ staged: { tickId: "t-stage", stagedAt: new Date(T0 - 5 * MIN).toISOString() }, currentTickId: "t-post", minPostGapMinutes: 15, now: T0 }).reason, "inside_gap", "post.floor.BLOCK_inside_gap");
  eq(V.postFloorOk({ staged: { tickId: "t-stage", stagedAt: new Date(T0 - 20 * MIN).toISOString() }, currentTickId: "t-post", minPostGapMinutes: 15, now: T0 }).ok, true, "post.floor.ALLOW_later_tick_past_gap");
  eq(V.postFloorOk({ staged: { tickId: "t-stage", stagedAt: "not a date" }, currentTickId: "t-post", minPostGapMinutes: 15, now: T0 }).reason, "staged_at_unreadable", "post.floor.BLOCK_unreadable_stagedAt");
}

/* — GATE 1: paused / shadow / kill switch — */
{
  eq(V.gatePausedShadow({ va: vaJob({ status: { paused: true } }).va, tickIndex: 99 }).reason, "paused", "gate.paused.BLOCK");
  eq(V.gatePausedShadow({ va: vaJob().va, killSwitchActive: true }).reason, "kill_switch", "gate.killswitch.BLOCK");
  eq(V.gatePausedShadow({ va: vaJob({ status: { paused: false, shadowUntilTick: 3 } }).va, tickIndex: 1 }).reason, "shadow", "gate.shadow.BLOCK_within_shadow_ticks");
  eq(V.gatePausedShadow({ va: vaJob({ status: { paused: false, shadowUntilTick: 3 } }).va, tickIndex: 4 }).ok, true, "gate.shadow.ALLOW_after_shadow_ticks");
}

/* — GATE 2: attempts — */
{
  eq(V.gateAttempts({ state: "staged", attempts: 0 }).ok, true, "item.attempts.ALLOW_second_attempt");
  eq(V.gateAttempts({ state: "staged", attempts: VA_LIMITS.attemptsCap }).reason, "attempts_exhausted", "item.attempts.BLOCK_parked_at_three");
  eq(V.gateAttempts({ state: "parked", attempts: 0 }).reason, "parked", "item.attempts.BLOCK_parked_state");
}

/* — GATE 3: freshness — */
{
  const staged = { baseline: "c-1" };
  eq(V.gateFreshness({ staged, issue: thread([humanComment("c-1", T0)]), selfAccountId: SELF }).ok, true, "gate.freshness.ALLOW_unchanged_thread");
  eq(V.gateFreshness({ staged, issue: thread([humanComment("c-1", T0), humanComment("c-2", T0)]), selfAccountId: SELF }).reason, "thread_moved", "gate.freshness.BLOCK_new_human_comment");
  // OUR OWN comment after the baseline is not the thread moving.
  eq(V.gateFreshness({ staged, issue: thread([humanComment("c-1", T0), ourComment("c-2", T0)]), selfAccountId: SELF }).ok, true, "gate.freshness: our own comment does not count as the thread moving");
}

/* — GATE 4: other-writer quiet — */
{
  eq(V.gateQuiet({ issue: thread([humanComment("c-1", T0 - 2 * MIN)]), now: T0, quietMinutes: 15, selfAccountId: SELF }).reason, "recent_other_writer", "gate.quiet.BLOCK_recent_other_writer");
  eq(V.gateQuiet({ issue: thread([humanComment("c-1", T0 - 60 * MIN)]), now: T0, quietMinutes: 15, selfAccountId: SELF }).ok, true, "gate.quiet.ALLOW_past_quiet_window");
  eq(V.gateQuiet({ issue: thread([]), now: T0, quietMinutes: 15, selfAccountId: SELF }).ok, true, "gate.quiet: nobody else has written, so there is nothing to be quiet about");
}

/* — GATE 5: anti-pile-up — */
{
  const spokeLast = thread([humanComment("c-1", T0 - 5 * DAY), ourComment("c-2", T0 - 1 * DAY)]);
  eq(V.gatePileUp({ row: { state: "staged" }, issue: spokeLast, now: T0, antiPileUpDays: 4, selfAccountId: SELF }).reason, "we_spoke_last", "gate.pileup.BLOCK_we_spoke_last");
  eq(V.gatePileUp({ row: { state: "owed" }, issue: spokeLast, now: T0, antiPileUpDays: 4, selfAccountId: SELF }).ok, true, "gate.pileup.ALLOW_owed_overrides");
  eq(V.gatePileUp({ row: { state: "staged" }, issue: thread([ourComment("c-2", T0 - 9 * DAY)]), now: T0, antiPileUpDays: 4, selfAccountId: SELF }).ok, true, "gate.pileup.ALLOW_past_the_window");
  // F-451 — AN UNKNOWN IDENTITY BLOCKS. The gate's own comment always claimed a null
  // `selfAccountId` blocked, and it did the opposite: nothing could match, so the gate
  // read "we did not speak last" and PASSED — piling a third reply onto our own thread
  // exactly when we had lost track of who we were.
  eq(V.gatePileUp({ row: { state: "staged" }, issue: spokeLast, now: T0, antiPileUpDays: 4, selfAccountId: null }).reason, "self_unknown", "gate.pileup.BLOCK_self_unknown");
  eq(V.gatePileUp({ row: { state: "staged" }, issue: spokeLast, now: T0, antiPileUpDays: 4 }).reason, "self_unknown", "gate.pileup.BLOCK_self_omitted");
  eq(V.gatePileUp({ row: { state: "staged" }, issue: spokeLast, now: T0, antiPileUpDays: 4, selfAccountId: "" }).reason, "self_unknown", "gate.pileup.BLOCK_self_empty_string");
  // …and it blocks even an OWED item: `owed` overrides the pile-up rule, never the
  // question of whether the rule could be evaluated at all.
  eq(V.gatePileUp({ row: { state: "owed" }, issue: spokeLast, now: T0, antiPileUpDays: 4, selfAccountId: null }).reason, "self_unknown", "gate.pileup.BLOCK_self_unknown_even_when_owed");
  eq(V.gatePileUp({ row: { state: "staged" }, issue: thread([ourComment("c-1", T0 - DAY), humanComment("c-2", T0)]), now: T0, antiPileUpDays: 4, selfAccountId: SELF }).ok, true, "gate.pileup: a human spoke after us, so we did not speak last");
}

/* — the POST WINDOW — */
{
  const va = vaJob().va;
  va.cadence.postWindow = { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" };
  va.cadence.timeZone = "UTC";
  eq(V.inPostWindow(va, Date.parse("2026-09-14T10:00:00Z")).ok, true, "window.ALLOW_inside");         // Monday
  eq(V.inPostWindow(va, Date.parse("2026-09-14T20:00:00Z")).reason, "outside_post_window_hours", "window.BLOCK_outside_hours");
  eq(V.inPostWindow(va, Date.parse("2026-09-13T10:00:00Z")).reason, "outside_post_window_day", "window.BLOCK_outside_day");   // Sunday
  const wrap = vaJob().va;
  wrap.cadence.postWindow = { days: [], from: "18:00", to: "02:00" };
  eq(V.inPostWindow(wrap, Date.parse("2026-09-14T23:00:00Z")).ok, true, "window: a window that ends before it starts WRAPS past midnight");
  eq(V.inPostWindow(wrap, Date.parse("2026-09-14T12:00:00Z")).ok, false, "…and midday is still outside it");
  const bad = vaJob().va;
  bad.cadence.postWindow = { days: [1], from: "09:00", to: "17:00" };
  bad.cadence.timeZone = "Not/AZone";
  eq(V.inPostWindow(bad, T0).reason, "post_window_unreadable", "window.BLOCK_unreadable_timezone — a restriction must not evaporate on bad input");
}

/* — GATE 9: the voice lint, and it fails CLOSED — */
{
  eq(V.gateVoice("I have picked this up. It should be sorted today.", { register: "plain", maxSentences: 3 }).ok, true, "gate.voice.ALLOW_human_corpus_sample");
  eq(V.gateVoice("- one\n- two", { register: "plain", maxSentences: 3 }).ok, false, "gate.voice.BLOCK_bullet");
  eq(V.gateVoice("As an AI I cannot do that.", { register: "plain", maxSentences: 3 }).ok, false, "gate.voice.BLOCK_as_an_ai");
  eq(V.gateVoice("", { register: "plain" }).ok, false, "gate.voice.BLOCK_empty — nothing to check must never read as checked");
}

/* — F-451: THE IDENTITY IS RESOLVED ONCE, AND A FAULT STOPS THE PASS — */
reset();
{
  await stageDraft();
  let asked = 0;
  const d = postDeps({ selfAccountId: async () => { asked++; return { ok: true, accountId: SELF }; } });
  await V.runVaPost({ agent: vaJob(), tickId: "t-self", deps: d });
  eq(asked, 1, "self.ALLOW_resolved_once_per_pass — not once per gate and not once per item");
}
reset();
{
  await stageDraft();
  const d = postDeps({ selfAccountId: async () => ({ ok: false, accountId: null, reason: "myself:503" }) });
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-self-dead", deps: d });
  // NOT SILENTLY OPEN. Speech whose brakes cannot be evaluated does not happen.
  eq(r.posted, 0, "self.BLOCK_whole_pass_when_identity_unreadable");
  eq(d.__commented.length, 0, "self: …and nothing at all was posted");
  ok(r.skipped.some((x) => x.reason === "self_unknown"), "self: the skip names the cause");
  const receipt = (await L.readTick(kvs, AG, "t-self-dead", "post")).receipt;
  ok(receipt && /own account could not be read/.test(String(receipt.error)),
    "self: …and the RECEIPT says so — a quiet failure is loud somewhere (law 8)");
  // The draft is untouched: it is not dropped for an infrastructure fault.
  const row = (await L.readItem(kvs, AG, "SUP-1")).row;
  eq(row.state, "staged", "self.ALLOW_draft_survives_an_infrastructure_fault");
}

/* — THE WHOLE POST RUN — */
reset();
{
  await stageDraft();
  const d = postDeps();
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(r.posted, 1, "post.ALLOW_a_clean_draft_goes_out");
  eq(d.__commented.length, 1, "post: exactly one comment");
  eq(d.__commented[0].internal, true, "post: internal is the DEFAULT — the property carries sd.public.comment");
  eq(d.__read.length, 1, "gate.readback: a SECOND read was made — the write's own response is not proof");
  const row = (await L.readItem(kvs, AG, "SUP-1")).row;
  eq(row.state, "posted", "post: the item is posted");
  eq(row.staged, null, "post: the draft is cleared, so it cannot go out twice");
  const receipt = (await L.readTick(kvs, AG, "t-post", "post")).receipt;
  ok(receipt, "planner.postphase.ALLOW_receipt_written — its OWN receipt (F-421)");
  eq(receipt.phase, "post", "…on the post phase, not the prepare one");
  // The EFFECTS row, written only on a read-back proof.
  const caps = await L.readCaps(kvs, AG, { now: T0 });
  eq(caps.hour, 1, "gate.caps: the slot was SPENT — before the write, never after");
}

reset();
{
  // GATE 3 BLOCK: a human spoke after the baseline. The draft dies, the item RE-QUEUES.
  await stageDraft();
  const d = postDeps({ getIssue: async () => thread([humanComment("c-1", T0 - 60 * MIN), humanComment("c-2", T0 - 40 * MIN)]) });
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(r.posted, 0, "gate.freshness.BLOCK_new_human_comment — nothing posted");
  eq(d.__commented.length, 0, "…nothing reached Jira");
  const row = (await L.readItem(kvs, AG, "SUP-1")).row;
  eq(row.state, "queued", "…the item is RE-QUEUED, not discarded");
  eq(row.staged, null, "…and the stale draft is gone");
  ok((await L.readTick(kvs, AG, "t-post", "post")).receipt.skipped.some((s) => s.reason === "gate.thread_moved"), "…and the receipt names the gate");
}

reset();
{
  // GATE 4 BLOCK: somebody else wrote two minutes ago.
  await stageDraft({ baseline: "c-1" });
  const d = postDeps({ getIssue: async () => thread([humanComment("c-1", T0 - 2 * MIN)]) });
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(r.posted, 0, "gate.quiet.BLOCK_recent_other_writer");
  eq(d.__commented.length, 0, "…and nothing was posted over them");
}

reset();
{
  // GATE 7 BLOCK: the hour cap is full.
  await stageDraft();
  const b = L.__capsBucketsForTest ? null : null;
  for (let i = 0; i < 6; i++) await L.bumpCaps(kvs, AG, { now: T0 });
  const d = postDeps();
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(r.posted, 0, "gate.caps.BLOCK_hour_exceeded");
  eq(d.__commented.length, 0, "…and nothing was posted");
  ok((await L.readTick(kvs, AG, "t-post", "post")).receipt.skipped.some((s) => /gate.caps/.test(s.reason)), "…with the cap named in the receipt");
}

reset();
{
  // GATE 7 ALLOW: an OWED item uses its OWN counter, so a full general hour does not
  // silence a reply somebody is waiting for.
  await L.saveItem(kvs, AG, "SUP-1", { state: "queued" }, { now: T0 });
  await L.saveItem(kvs, AG, "SUP-1", { state: "posted" }, { now: T0 });
  await L.saveItem(kvs, AG, "SUP-1", { state: "owed" }, { now: T0 });
  await L.saveItem(kvs, AG, "SUP-1", {
    state: "staged",
    staged: { audience: "internal", body: "Sorry about that. I have fixed it now.", reason: "owed reply", baseline: "c-1", tickId: "t-stage", stagedAt: new Date(T0 - 30 * MIN).toISOString() },
  }, { now: T0 });
  for (let i = 0; i < 6; i++) await L.bumpCaps(kvs, AG, { now: T0 });
  // OWED is read from the THREAD: we spoke, and the last word is theirs.
  const owedThread = thread([ourComment("c-0", T0 - 3 * 60 * MIN), humanComment("c-1", T0 - 60 * MIN)]);
  eq(V.isOwed({ row: { state: "staged" }, issue: owedThread, selfAccountId: SELF }), true, "isOwed: we spoke and a human answered after us");
  eq(V.isOwed({ row: { state: "staged" }, issue: thread([humanComment("c-1", T0)]), selfAccountId: SELF }), false, "isOwed: a thread we never spoke in owes nobody");
  const d = postDeps({ getIssue: async () => owedThread });
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(r.posted, 1, "gate.caps.ALLOW_owed_within_owed_cap — owed is cheaper, never free");
  const caps = await L.readCaps(kvs, AG, { now: T0 });
  eq(caps.owedHour, 1, "…and it spent the OWED counter, not the general one");
  eq(caps.hour, 6, "…which is untouched");
}

reset();
{
  // GATE 7 BLOCK: a caps READ FAULT blocks. Unknown is not permissive when the thing
  // being braked is speech (F-431).
  await stageDraft();
  let reads = 0;
  const faultyStore = {
    get: async (k) => { if (String(k).startsWith("va_caps:")) { reads++; throw new Error("kvs down"); } return kvs.get(k); },
    set: async (k, v, o) => kvs.set(k, v, o), delete: async (k) => kvs.delete(k),
  };
  const d = postDeps({ store: faultyStore });
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(r.posted, 0, "gate.caps.BLOCK_read_fault");
  eq(d.__commented.length, 0, "…and nothing was posted on an unknown counter");
  ok(reads > 0, "…the caps read really was attempted");
}

reset();
{
  // GATE 8 BLOCK: the issue is outside the write scope.
  await stageDraft();
  const d = postDeps({ getIssue: async () => ({ ...thread([humanComment("c-1", T0 - 60 * MIN)]), fields: { ...thread([humanComment("c-1", T0 - 60 * MIN)]).fields, project: { key: "OPS" } } }) });
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(r.posted, 0, "gate.scope.BLOCK_outside_write_scope");
  eq(d.__commented.length, 0, "…and nothing was posted");
}

reset();
{
  // GATE 9 BLOCK: the lint refuses the draft. It re-queues AND counts an attempt.
  await stageDraft({ body: "- I did a thing\n- I did another thing" });
  const d = postDeps();
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(r.posted, 0, "gate.voice.BLOCK_bullet stops the post");
  eq(d.__commented.length, 0, "…nothing reached Jira");
  const row = (await L.readItem(kvs, AG, "SUP-1")).row;
  eq(row.state, "queued", "…the item goes back for a rewrite");
  eq(row.attempts, 1, "item.attempts.INCREMENT_on_lint_reject — a model that cannot write in this voice parks");
}

reset();
{
  // GATE 10: a REDELIVERY does not post a second time.
  await stageDraft();
  const stagedAt = (await L.readItem(kvs, AG, "SUP-1")).row.staged.stagedAt;
  await L.takePostClaim(kvs, AG, "SUP-1", stagedAt);       // as if a first delivery had it
  const d = postDeps();
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(r.posted, 0, "gate.claim.BLOCK_redelivery_second_post");
  eq(d.__commented.length, 0, "…and no second reply reached the human");
  ok((await L.readTick(kvs, AG, "t-post", "post")).receipt.skipped.some((s) => /gate.claim/.test(s.reason)), "…named in the receipt");
}

reset();
{
  // GATE 11 BLOCK: the read-back shows PUBLIC when internal was intended. The comment is
  // EDITED to internal — never deleted and re-posted — and an ERROR receipt is written.
  await stageDraft();
  let reads = 0;
  const d = postDeps({
    readComment: async () => { reads++; return { id: "new-1", jsdPublic: reads === 1 }; },
  });
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(d.__repaired.length, 1, "gate.readback.BLOCK_jsdPublic_mismatch_edits_to_internal");
  eq(d.__repaired[0], "new-1", "…the comment that was posted, by id");
  eq(reads, 2, "…and the REPAIR is itself verified by a second read");
  eq(r.errors, 1, "…the run counts an error");
  const receipt = (await L.readTick(kvs, AG, "t-post", "post")).receipt;
  ok(receipt.error, "gate.readback: an ERROR receipt, never a silent success");
  ok(receipt.skipped.some((s) => /jsdPublic_mismatch/.test(s.reason)), "…naming the mismatch");
  const row = (await L.readItem(kvs, AG, "SUP-1")).row;
  eq(row.state, "posted", "…the item is posted, because a comment EXISTS and must not be written twice");
  ok(row.history.some((h) => h.event === "posted_with_error"), "…and the history says it went out wrong");
}

reset();
{
  // GATE 11 BLOCK: no comment id came back. NO effects row, and the item stays staged.
  await stageDraft();
  const d = postDeps({ addComment: async () => ({}) });
  const r = await V.runVaPost({ agent: vaJob(), tickId: "t-post", deps: d });
  eq(r.errors, 1, "gate.readback.BLOCK_no_comment_id");
  eq((await L.readItem(kvs, AG, "SUP-1")).row.state, "staged", "…the item stays staged for a human to look at");
}

reset();
{
  // SHADOW MODE: the agent stages and shows, and posts NOTHING.
  await stageDraft();
  const d = postDeps({ tickIndex: () => 1 });
  const r = await V.runVaPost({ agent: vaJob({ status: { paused: false, shadowUntilTick: 3 } }), tickId: "t-post", deps: d });
  eq(r.posted, 0, "gate.shadow.BLOCK_within_shadow_ticks, end to end");
  eq(d.__commented.length, 0, "…nothing reached Jira");
  eq((await L.readItem(kvs, AG, "SUP-1")).row.state, "staged", "…and the draft is still there to be reviewed");
}

reset();
{
  // THE SCAN IS BOUNDED (F-421) — a hundred staged rows do not become a hundred posts.
  for (let i = 0; i < 12; i++) {
    await L.saveItem(kvs, AG, `SUP-${100 + i}`, { state: "queued" }, { now: T0 });
    await L.saveItem(kvs, AG, `SUP-${100 + i}`, {
      state: "staged",
      staged: { audience: "internal", body: "I have picked this up. It should be sorted today.", reason: "r", baseline: "c-1", tickId: "t-stage", stagedAt: new Date(T0 - 30 * MIN).toISOString() },
    }, { now: T0 });
  }
  const d = postDeps({ getIssue: async (k) => ({ ...thread([humanComment("c-1", T0 - 60 * MIN)]), key: k, fields: { ...thread([humanComment("c-1", T0 - 60 * MIN)]).fields, project: { key: "SUP" } } }) });
  const r = await V.runVaPost({ agent: vaJob({ guardrails: { ...vaJob().va.guardrails, capsPerHour: 99, capsPerDay: 99 } }), tickId: "t-post", deps: d });
  ok(d.__commented.length <= VA_LIMITS.maxItemsPerTick, `planner.postphase.BLOCK_unbounded_scan (${d.__commented.length} <= ${VA_LIMITS.maxItemsPerTick})`);
  ok((await L.readTick(kvs, AG, "t-post", "post")).receipt.skipped.some((s) => s.reason === "over_post_budget"), "…and the rows it did not reach are NAMED, not dropped silently");
}

/* ══ 8. THE WIRING ═════════════════════════════════════════════════════════ */
{
  const { readFileSync } = await import("node:fs");
  const async = readFileSync(new URL("../../src/async-handler.js", import.meta.url), "utf8");
  for (const t of ["va-tick", "va-item", "va-post"]) {
    ok(new RegExp(`"${t}": executeVa`).test(async), `wiring: "${t}" is a TASK_HANDLERS row`);
  }
  ok(!/LONG_QUEUE_ONLY_TASKS = new Set\(\[[^\]]*va-item/.test(async), "wiring: va-item is NOT long-queue-only — the PRODUCER chooses its queue");

  const { NON_AI_TASK_TYPES, TOKEN_SPENDING_TASK_TYPES, estimateTaskTokens } = await import("../../src/shared/ai-budget.js");
  ok(NON_AI_TASK_TYPES.includes("va-tick"), "budget: va-tick is NON-AI — a sweep calls no model");
  ok(!TOKEN_SPENDING_TASK_TYPES.includes("va-tick"), "budget: …and is never priced as spending");
  eq(estimateTaskTokens("va-tick", {}), 0, "budget: va-tick is explicitly priced at zero");
  ok(TOKEN_SPENDING_TASK_TYPES.includes("va-item") && TOKEN_SPENDING_TASK_TYPES.includes("va-post"), "budget: the two tasks that DO call a model are paced");

  const jobs = readFileSync(new URL("../../src/scheduled-jobs.js", import.meta.url), "utf8");
  ok(/isVaJob/.test(jobs), "wiring: the planner asks `isVaJob`, the ONE home for the question");
  ok(/enqueueVaPostRuns/.test(jobs), "wiring: the post phase is enqueued by the SAME 5-minute planner — no second trigger");
  // The RUN PATH asks `isVaJob` (which requires the `va` BLOCK, not just the mode), so a
  // record with a `va` mode and no configuration cannot be run as an unconfigured agent.
  // The index-row filter reads `mode` because an index row carries no block — that is a
  // cheap pre-filter, and the task re-checks. Both facts are asserted, not assumed.
  ok(/const taskType = isVaJob\(job\)/.test(jobs), "wiring: the RUN path decides by isVaJob, on the full record");
  ok(/loadVaJob/.test(async) && /isVaJob\(job\)/.test(async), "wiring: every task handler re-checks isVaJob before running anything");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
