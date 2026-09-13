/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * THE VIRTUAL ADMINISTRATOR ENGINE (1.5 commit 3).
 *
 * A Virtual Administrator is a scheduled job with `mode:"va"`. It works a queue over
 * DAYS, which means it can never re-decide from scratch: everything it knows between one
 * 5-minute tick and the next is a row in `src/va-ledger.js`, and everything it may do is
 * a number in `src/shared/va-config.js`. This file is the CALLER of both. It owns no
 * rule of its own — a constant here that also exists in `va-config.js`, or a claim here
 * that also exists in `scheduled-jobs.js`, is a finding, not a convenience.
 *
 * THE THREE TASKS, and why they are three and not one:
 *
 *   `va-tick`  PREPARE. Sweep the intake, diff it against the ledger, fan out at most
 *              `maxItemsPerTick` item tasks, write a receipt. NO MODEL CALL — it is in
 *              `NON_AI_TASK_TYPES` and priced at zero, because reserving tokens a sweep
 *              never spends would starve the work that does spend them.
 *   `va-item`  ONE bounded turn on ONE issue. The only task that calls a model.
 *   `va-post`  The two-phase speech clock's second half: the eleven gates, then at most
 *              one comment per staged row. Its OWN task with its OWN receipt (F-421) —
 *              it is not a side-errand of the prepare tick, because a receipt the post
 *              phase shares with the prepare tick is a receipt that erases the evidence
 *              somebody is looking for.
 *
 * WHY THE SPEECH IS TWO-PHASE AT ALL. An agent that writes and posts in the same turn
 * has no moment at which a human, a fresher read, a cap or a lint can stop it. Splitting
 * PREPARE from POST buys exactly that moment, and the wall-clock floor
 * (`minPostGapMinutes` AND a later `tickId`, both, see `postFloorOk`) is what makes the
 * moment real rather than nominal.
 *
 * EVERY PLATFORM CALL GOES THROUGH `deps`. Not for elegance: the whole of this engine's
 * risk is in ORDER (claim before side effect, gate before write, read-back before an
 * effects row), and order can only be asserted by a test that can see every call. The
 * production defaults are resolved lazily at the bottom of this file, so importing this
 * module offline costs nothing and reaches no Forge API.
 */
import {
  readItem, saveItem,
  fingerprintOf, diffCandidates,
  recordTick, recordTickHealth,
} from "./va-ledger.js";
import {
  VA_LIMITS, VA_DEFAULTS, VA_PROJECT_KEY_RE, VA_JQL_MAX,
} from "./shared/va-config.js";

const nowIso = (ms) => new Date(ms == null ? Date.now() : ms).toISOString();
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * "IS THIS JOB A VIRTUAL ADMINISTRATOR" — ONE HOME.
 *
 * `mode:"va"` is a third value on a field that was binary for two releases, so every
 * site that asks the question asks it THROUGH this predicate. The scheduler, the
 * consumer and the REST layer must not each spell `job.mode === "va"`: the day the
 * answer needs a second condition (a record with no `va` block is not a VA, whatever
 * its mode says) only one of the three would learn it.
 */
export const isVaJob = (job) => Boolean(job && job.mode === "va" && isObj(job.va));

/** The VA record off a job, or null. */
export const vaOf = (job) => (isVaJob(job) ? job.va : null);

/** One guardrail number, from the record, falling back to the least permissive default. */
export const guard = (va, field) => {
  const g = isObj(va && va.guardrails) ? va.guardrails : {};
  const value = Number(g[field]);
  return Number.isFinite(value) ? value : Number(VA_DEFAULTS.guardrails[field]);
};

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. SCOPE-WRAPPED JQL — the intake's injection surface
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The read scope, as a validated list of project keys. `site:true` answers `null`,
 * which means "do not wrap" — NOT "wrap with nothing".
 *
 * The difference matters: a wrapper built from an empty list would render
 * `project in ()`, which is a JQL syntax error at best and, on a parser that tolerates
 * it, a query with no restriction at all. So an empty non-site scope REFUSES.
 */
export const readScopeProjects = (va) => {
  const scope = isObj(va && va.scope) ? va.scope : {};
  const read = isObj(scope.read) ? scope.read : {};
  if (read.site === true) return null;
  return [...new Set(asArray(read.projects).map((k) => String(k).trim().toUpperCase()).filter((k) => VA_PROJECT_KEY_RE.test(k)))];
};

/**
 * Scan `jql` once, OUTSIDE string literals, and report the three things a wrapper can be
 * broken by. Quote state is tracked with backslash escaping because `summary ~ "it\"s"`
 * is legal JQL and a naive `indexOf` would read the rest of that string as code.
 */
const scanJql = (jql) => {
  let depth = 0;
  let minDepth = 0;
  let quote = null;
  const orderByAt = [];
  for (let i = 0; i < jql.length; i++) {
    const c = jql[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth < minDepth) minDepth = depth; }
    else if ((c === "o" || c === "O") && /^order\s+by\b/i.test(jql.slice(i))) { orderByAt.push(i); i += 4; }
  }
  return { unbalancedQuote: quote !== null, depth, minDepth, orderByAt };
};

/**
 * WRAP THE OPERATOR'S JQL INSIDE THE READ SCOPE.
 *
 * `(<operator clause>) AND project in (<read scope>)`. This is a STRING CONCATENATION
 * AROUND UNTRUSTED OPERATOR TEXT, which makes it the sharpest surface in the intake: the
 * FRAME names it as the thing the breaker attacks first. So the clause is not merely
 * wrapped, it is PROVED wrappable before it is wrapped, and every way it could escape the
 * parentheses is a NAMED REFUSAL rather than a best-effort repair:
 *
 *   · `ORDER BY` — legal only as the FINAL segment of a query, so a clause carrying one
 *     cannot go inside `(...)` at all. A TRAILING one is STRIPPED (the operator meant to
 *     order their results and the wrapper re-imposes its own ordering anyway, so nothing
 *     they asked for is lost). One that is NOT trailing — inside a sub-clause, or two of
 *     them — is REFUSED by name: it is either an injection attempt or a query that was
 *     never valid, and guessing which is not this function's job.
 *   · an unbalanced quote — the clause would swallow the wrapper we append.
 *   · unbalanced parentheses — a trailing `)` closes OUR wrapper and everything after it
 *     escapes; a missing one absorbs it. `minDepth < 0` catches the close-first shape
 *     that a bare `depth === 0` check reads as balanced (`a) AND (b`).
 *   · a trailing operator — `... AND` would bind our `project in (...)` as its own right
 *     operand, so the scope restriction becomes part of the operator's expression rather
 *     than an AND over it.
 *   · length — a clause longer than the record's own clamp cannot have come from a
 *     validated save.
 *
 * FAILS CLOSED, always: `{ok:false, reason}` and NO query. An intake source that cannot
 * be bounded produces no candidates; it never falls back to an unbounded sweep, which is
 * the entire blast radius this gate exists for.
 */
export const wrapScopedJql = (rawJql, projects, { maxChars = VA_JQL_MAX, order = "ORDER BY updated DESC" } = {}) => {
  const jql = String(rawJql == null ? "" : rawJql).trim();
  if (!jql) return { ok: false, reason: "jql_empty" };
  if (jql.length > maxChars) return { ok: false, reason: "jql_too_long", detail: `${jql.length} > ${maxChars}` };
  // `projects === null` is the site-wide read scope: nothing to restrict to.
  if (projects !== null && (!Array.isArray(projects) || projects.length === 0)) return { ok: false, reason: "read_scope_empty" };
  if (projects !== null && projects.some((k) => !VA_PROJECT_KEY_RE.test(String(k)))) return { ok: false, reason: "read_scope_invalid" };

  const scan = scanJql(jql);
  if (scan.unbalancedQuote) return { ok: false, reason: "unbalanced_quote" };
  if (scan.depth !== 0 || scan.minDepth < 0) return { ok: false, reason: "unbalanced_parens" };

  let clause = jql;
  let orderByStripped = false;
  if (scan.orderByAt.length) {
    // "Trailing" means: the only one, and the clause before it is itself balanced.
    // Anything else is refused rather than repaired.
    if (scan.orderByAt.length > 1) return { ok: false, reason: "order_by_not_trailing" };
    const head = jql.slice(0, scan.orderByAt[0]).trim();
    if (!head) return { ok: false, reason: "jql_is_only_order_by" };
    // Re-scan the head alone: an ORDER BY inside a parenthesised sub-clause leaves the
    // head unbalanced, which is the tell that it was never trailing.
    const headScan = scanJql(head);
    if (headScan.unbalancedQuote || headScan.depth !== 0 || headScan.minDepth < 0) return { ok: false, reason: "order_by_not_trailing" };
    clause = head;
    orderByStripped = true;
  }

  if (/(\b(AND|OR|NOT|IN|WAS|CHANGED)\b|[=~<>!,+-])\s*$/i.test(clause)) return { ok: false, reason: "trailing_operator" };

  const scoped = projects === null ? `(${clause})` : `(${clause}) AND project in (${projects.join(", ")})`;
  return { ok: true, jql: `${scoped}${order ? ` ${order}` : ""}`, orderByStripped, clause };
};

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. THE SWEEP — what the agent can even see
 * ════════════════════════════════════════════════════════════════════════════ */

const CANDIDATE_FIELDS = ["summary", "status", "issuetype", "priority", "assignee", "reporter", "project", "updated", "comment"];

/**
 * Read one JSM queue. BOUNDED at the call, `asApp`, and a dead source is a REPORTED
 * source, never a silent one.
 *
 * FAIL CONTRACT, and it is deliberately NOT the same as the JQL half's: a queue that
 * 404s (deleted, re-numbered, or the desk was re-scoped) makes THAT SOURCE dead and the
 * tick continues with the others. A dead queue must not silence the whole agent — an
 * admin who removed one queue of four has not asked for the agent to stop. The JQL half
 * fails CLOSED because a scope read that faults could otherwise widen the sweep; a queue
 * read that faults can only narrow it.
 */
const sweepQueues = async (va, deps, remaining) => {
  const out = [];
  const dead = [];
  const intake = isObj(va.intake) ? va.intake : {};
  for (const desk of asArray(intake.serviceDesks)) {
    for (const queueId of asArray(desk && desk.queueIds)) {
      if (out.length >= remaining) return { issues: out, dead, truncated: true };
      try {
        const res = await deps.jsmQueueIssues(desk.serviceDeskId, queueId, { limit: Math.min(50, remaining - out.length) });
        if (!res || res.ok === false) { dead.push({ key: `sd:${desk.serviceDeskId}/${queueId}`, reason: `queue_unavailable:${(res && res.status) || "?"}` }); continue; }
        for (const issue of asArray(res.issues)) {
          if (out.length >= remaining) break;
          out.push(issue);
        }
      } catch (e) {
        dead.push({ key: `sd:${desk.serviceDeskId}/${queueId}`, reason: `queue_failed:${String((e && e.message) || e).slice(0, 80)}` });
      }
    }
  }
  return { issues: out, dead, truncated: false };
};

/**
 * THE SWEEP. Three intake sources, ONE budget across all of them
 * (`VA_LIMITS.maxCandidatesPerTick`), deduplicated by issue key, and every source that
 * could not be read named in `dead[]` so the receipt can say so.
 *
 * The budget is shared rather than per-source on purpose: three sources with 50 each is
 * 150 reads on a five-minute clock, and the cap exists to bound the TICK, not the source.
 * Order is queues, then JQL, then mentions, so a desk's own queue is never crowded out by
 * a broad standing query.
 *
 * MENTIONS CAN NEVER WIDEN THE WRITE SCOPE (F-410). They are searched over the READ scope
 * through the same wrapper as the operator's JQL, and the fact that somebody named the
 * agent on an issue is not a grant to write on it — the write-scope gate still decides
 * that, from the write scope alone.
 */
export const sweepIntake = async (va, deps, { maxCandidates = VA_LIMITS.maxCandidatesPerTick } = {}) => {
  const intake = isObj(va.intake) ? va.intake : {};
  const projects = readScopeProjects(va);
  const seen = new Map();
  const dead = [];
  const notes = [];
  const cap = Math.max(0, Math.trunc(Number(maxCandidates) || 0));

  const take = (issue, source) => {
    const key = issue && issue.key;
    if (!key || seen.has(key) || seen.size >= cap) return;
    seen.set(key, { key, source, issue, fingerprint: fingerprintOf(issue), mention: source === "mention" });
  };

  const q = await sweepQueues(va, deps, cap);
  for (const issue of q.issues) take(issue, "queue");
  dead.push(...q.dead);

  const runQuery = async (rawJql, source) => {
    if (seen.size >= cap) return;
    const wrapped = wrapScopedJql(rawJql, projects);
    if (!wrapped.ok) { dead.push({ key: source, reason: `jql_refused:${wrapped.reason}` }); return; }
    if (wrapped.orderByStripped) notes.push({ key: source, reason: "order_by_stripped" });
    try {
      const res = await deps.searchJql({ jql: wrapped.jql, maxResults: Math.min(50, cap - seen.size), fields: CANDIDATE_FIELDS });
      for (const issue of asArray(res && res.issues)) take(issue, source);
    } catch (e) {
      // FAIL CLOSED for a scope-bounded query: no candidates from this source, said out
      // loud. The alternative — carrying on with a partial or unbounded read — is how an
      // agent comes to act on issues nobody scoped it to.
      dead.push({ key: source, reason: `search_failed:${String((e && e.message) || e).slice(0, 80)}` });
    }
  };

  if (String(intake.jql || "").trim()) await runQuery(intake.jql, "jql");

  for (const accountId of asArray(intake.mentionsOf)) {
    if (seen.size >= cap) break;
    // `comment ~ "<accountId>"` is the only portable way to ask "was this person named":
    // Jira's mention markup carries the accountId, and the text search sees it. The
    // quotes are stripped from the id, and the id itself is charset-clamped by
    // `normalizeVa` at save time — two independent reasons the literal cannot close.
    await runQuery(`comment ~ "${String(accountId).replace(/["\\]/g, "")}"`, "mention");
  }

  return { candidates: [...seen.values()], dead, notes, truncated: seen.size >= cap };
};

/* ══════════════════════════════════════════════════════════════════════════════
 * 3. THE PREPARE TICK
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Which queue does one item task belong on?
 *
 * DECIDED AT THE PRODUCER, never at the handler (the FRAME's rule). An item whose agent
 * holds a Confluence, git or web power can spend minutes in one round — a page read, a
 * PR fetch and a search on top of eight model rounds — and the 120 s consumer would kill
 * it holding its claim. A plain item stays on the short consumer, where it belongs, so
 * the long consumer is not filled with work that never needed it.
 */
export const itemQueueFor = (va) => {
  const p = isObj(va && va.powers) ? va.powers : {};
  return (p.confluenceRead || p.confluenceWrite || p.git || p.webSearch) ? "long-queue" : "async-ai-queue";
};

/**
 * `va-tick` — PREPARE. Sweep, diff, fan out, receipt. NO MODEL CALL.
 *
 * THE CLAIMS, and who owns each (F-139 paid for this ambiguity once already, on
 * `job_claim`; it is written down here so it cannot be re-litigated by reading the code):
 *   · `job_claim:{id}:{fireIdentity}` — taken by the SCHEDULER TICK
 *     (`scheduled-jobs.js`), before this task is ever enqueued. It makes the 5-minute
 *     tick idempotent against duplicate trigger deliveries. Not taken here.
 *   · `va_exec:{agent}:{key}:{tickId}` — taken by the CONSUMER at the start of
 *     `runVaItem`, NOT here (F-422). A producer-side claim is a claim held by a task
 *     that may never run: the queue push can fail after it, and the item is then silent
 *     until the TTL expires. The producer fans out; the consumer claims.
 *
 * FAIL CONTRACT. A tick that cannot sweep still writes a RECEIPT saying so, and bumps the
 * health counter (F-426). A tick that writes no receipt is the quiet failure §3.14 law 8
 * exists to forbid — the receipt is the only thing an admin can read tomorrow.
 */
export const runVaTick = async ({ job, tickId = null, deps: injected = {} } = {}) => {
  const deps = withDeps(injected);
  const started = nowIso(deps.now());
  const va = vaOf(job);
  if (!va) return { ok: false, reason: "not_a_va_job" };
  const agent = job.id;
  const tick = String(tickId || deps.tickId(job));
  const skipped = [];
  let candidates = 0;
  let fannedOut = 0;

  try {
    // A PAUSED agent does no work at all, and says so in its receipt. The post gate
    // checks this too — both, deliberately: pausing must stop the SPEND (here) as well
    // as the SPEECH (there), and an agent that keeps sweeping while paused is a bill.
    if (isObj(va.status) && va.status.paused === true) {
      await recordTick(deps.store, agent, { tickId: tick, phase: "prepare", started, candidates: 0, staged: 0, skipped: [{ key: "(agent)", reason: "paused" }] });
      await recordTickHealth(deps.store, agent, true, { now: deps.now() });
      return { ok: true, paused: true, candidates: 0, fannedOut: 0, skipped: [{ key: "(agent)", reason: "paused" }] };
    }

    const maxItems = Math.max(0, Math.trunc(guard(va, "maxItemsPerTick")));
    const sweep = await sweepIntake(va, deps, {});
    candidates = sweep.candidates.length;
    skipped.push(...sweep.dead, ...sweep.notes);

    // The ledger half of the diff: read only the rows for the keys we actually swept.
    const rows = {};
    const unreadable = new Set();
    for (const c of sweep.candidates) {
      const r = await readItem(deps.store, agent, c.key);
      if (r.readFailed) {
        // An unknown row must not be read as "never seen" — that would re-work a parked
        // or already-staged item. It is dropped from this tick, by name.
        skipped.push({ key: c.key, reason: "item_read_failed" });
        unreadable.add(c.key);
        continue;
      }
      if (r.row) rows[c.key] = r.row;
    }
    const readable = sweep.candidates.filter((c) => !unreadable.has(c.key));

    const diff = diffCandidates(readable, rows, { maxItemsPerTick: maxItems, now: deps.now() });
    skipped.push(...diff.skipped, ...diff.deferred);

    const queueKey = itemQueueFor(va);
    for (const candidate of diff.candidates) {
      const source = readable.find((c) => c.key === candidate.key);
      // The row is moved to `queued` BEFORE the push, and the fingerprint we diffed
      // against is stored with it: if the push fails, the next tick sees a queued row
      // with a current fingerprint and re-queues it, which is the recoverable direction.
      const saved = await saveItem(deps.store, agent, candidate.key, {
        state: "queued",
        fingerprint: source ? source.fingerprint : null,
        event: "queued",
        reason: candidate.reason,
      }, { now: deps.now() });
      if (!saved.ok) { skipped.push({ key: candidate.key, reason: saved.reason }); continue; }
      try {
        await deps.pushTask(queueKey, {
          taskType: "va-item",
          taskId: deps.makeTaskId("va-item"),
          params: { agent, jobId: agent, issueKey: candidate.key, tickId: tick, reason: candidate.reason, enqueuedAt: nowIso(deps.now()) },
        });
        fannedOut++;
      } catch (e) {
        skipped.push({ key: candidate.key, reason: `fanout_failed:${String((e && e.message) || e).slice(0, 60)}` });
      }
    }

    await recordTick(deps.store, agent, {
      tickId: tick, phase: "prepare", started,
      candidates, staged: fannedOut, skipped,
      next: deps.nextRunOf ? deps.nextRunOf(job) : null,
    });
    await recordTickHealth(deps.store, agent, true, { now: deps.now() });
    return { ok: true, candidates, fannedOut, skipped, queue: queueKey };
  } catch (e) {
    const error = String((e && e.message) || e).slice(0, 300);
    // BOTH, and in this order: the receipt is the evidence, the health row is the banner.
    // F-426 is precisely the defect of deriving the second from the first.
    await recordTick(deps.store, agent, { tickId: tick, phase: "prepare", started, candidates, staged: fannedOut, skipped, error });
    await recordTickHealth(deps.store, agent, false, { reason: error, now: deps.now() });
    return { ok: false, reason: "tick_failed", detail: error, candidates, fannedOut };
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
 * 9. DEPS — every platform reach, injectable, resolved lazily
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * THE FAN-OUT'S CONCURRENCY KEY, carried FROM THE FIRST PUSH (§4b row 38b).
 *
 * The token ledger's read-modify-write is not atomic, so five item tasks delivered in the
 * same instant can each read the same "used" figure and each decide it fits. The platform
 * concurrency key is the only thing that actually serialises them, and it has to be on the
 * push — adding it later, once a burst has been observed, is adding it after the burst it
 * would have prevented.
 */
export const AI_BUDGET_CONCURRENCY = Object.freeze({ key: "ai-budget", limit: 2 });

let _store = null;
const lazyStore = () => {
  if (!_store) {
    // A lazy wrapper rather than a top-level import: `@forge/kvs` is mocked by module
    // resolution in the offline suite, and a test that injects its own store must be
    // able to avoid loading it at all.
    _store = {
      get: async (k) => (await import("@forge/kvs")).kvs.get(k),
      set: async (k, v, o) => (await import("@forge/kvs")).kvs.set(k, v, o),
      delete: async (k) => (await import("@forge/kvs")).kvs.delete(k),
    };
  }
  return _store;
};

/**
 * The production implementations, imported ON FIRST USE.
 *
 * A default that has no production implementation in this commit THROWS a named error
 * rather than returning an empty result, because an empty result reads as "there is
 * nothing there" — the proven-negative trap this engine must never fall into.
 */
const REQUIRED = (name) => async () => { throw new Error(`virtual-admin: deps.${name} was not supplied and has no production default in this build`); };

export const DEFAULT_DEPS = {
  now: () => Date.now(),
  /**
   * The tick identity. It is the FIVE-MINUTE BUCKET, not the instant: the post phase's
   * second floor condition is `stagedTickId !== currentTickId`, and an identity minted
   * from `Date.now()` would make every delivery its own tick and disable that half of
   * the floor silently. The caller (the scheduler) passes the real one; this is the
   * fallback for a manual run.
   */
  tickId: (job) => `${(job && job.id) || "va"}-${Math.floor(Date.now() / 300000)}`,
  makeTaskId: (kind) => `${kind}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
  nextRunOf: null,

  searchJql: async ({ jql, maxResults = 50, fields = CANDIDATE_FIELDS }) => {
    const { default: api, route } = await import("@forge/api");
    const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jql, maxResults, fields }),
    });
    if (!res.ok) throw new Error(`search failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
    return res.json();
  },

  /**
   * JSM queue issues, `asApp`. Probe P4 of the FRAME is open on whether
   * `servicedeskapi` answers from a CONSUMER (it is proven from the probe surface only),
   * which is why a failure here is a DEAD SOURCE and not a dead tick: if the probe comes
   * back negative the queue arm degrades to the JQL arm with no other change.
   */
  jsmQueueIssues: async (serviceDeskId, queueId, { limit = 50 } = {}) => {
    const { default: api, route } = await import("@forge/api");
    const res = await api.asApp().requestJira(route`/rest/servicedeskapi/servicedesk/${serviceDeskId}/queue/${queueId}/issue?limit=${limit}`);
    if (!res.ok) return { ok: false, status: res.status, issues: [] };
    const data = await res.json();
    return { ok: true, issues: asArray(data.values) };
  },

  pushTask: async (queueKey, body) => {
    const { Queue } = await import("@forge/events");
    await new Queue({ key: queueKey }).push({ body, concurrency: AI_BUDGET_CONCURRENCY });
  },

  getJob: REQUIRED("getJob"),
  log: (s) => console.log(`[va] ${String(s).slice(0, 500)}`),
};

/** Merge injected deps over the defaults. One home, so no entry point can forget one. */
export const withDeps = (injected) => {
  const d = { ...DEFAULT_DEPS, ...(isObj(injected) ? injected : {}) };
  if (!d.store) d.store = lazyStore();
  return d;
};
