/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE FIRST VIRTUAL ADMINISTRATOR, LIVE, IN SHADOW MODE — and the proof that it
 * posted NOTHING (release 1.5, commits 1/2/3/5a-c/6a/7).
 *
 * It creates one agent on the JT service desk, runs its PREPARE tick, reads the staged
 * drafts, runs the POST phase, and proves — with a SECOND REST READ of every JT issue's
 * comment list, before and after — that no comment was written. Then it pauses the
 * agent, re-ticks to prove F-414 (a staged item is not re-staged and `attempts` does not
 * move), and deletes everything it made.
 *
 * WHAT THE DEV HOOK CAN AND CANNOT DRIVE, and what this script does instead. The
 * `invokeResolver` allow-list in src/test-hook.js DELIBERATELY EXCLUDES `runVaTickNow`,
 * `runVaPostNow`, `pauseVa`, `resumeVa` and `vaCatalog` — "a harness that can run a VA
 * tick is a harness that can be turned into one". This script therefore reaches the SAME
 * task bodies through doors that are allow-listed, and every substitution is named in the
 * output so a reader never mistakes one for the other:
 *
 *   run tick  → `runScheduledJobNow`, which calls `enqueueJobRun`, which branches on
 *               `isVaJob` and pushes the IDENTICAL `va-tick` task with the same
 *               five-minute-bucket `tickId` the scheduler mints
 *               (src/scheduled-jobs.js — the branch is there precisely so run-now and
 *               the scheduler cannot diverge).
 *   post      → the real 5-minute planner, which enqueues a `va-post` task for every
 *               enabled VA on every tick (`enqueueVaPostRuns`). Slower, and strictly
 *               more honest than a resolver shortcut.
 *   pause     → `saveScheduledJob` with `va.status.paused = true`. NOT the same door as
 *               `pauseVa` (which also writes a receipt and does not re-arm shadow), so
 *               the pause EVIDENCE here is the tick's own behaviour, not the receipt
 *               `pauseVa` would have written.
 *   catalogue → `saveScheduledJob`'s own `mode:"va"` arm calls `vaAdmin.catalog()` and
 *               validates the desk id, the queue ids and the project keys against it,
 *               reporting `catalogue.*` in `refused[]` when a source could not be read.
 *               A save that keeps desk 1 and queues 1/2/3 is the catalogue seeing them.
 *
 * Receipts, ledger rows and the health row are read BOTH ways: through `getVaStatus` /
 * `listVaDrafts` (the resolver layer an admin actually sees) and through the hook's
 * unrestricted `?what=kvs` read of `va_tick:*` / `va_item:*` (the row itself). A
 * disagreement between the two is a finding.
 *
 * Usage (from test-harness/):
 *   node scripts/va-shadow-live.mjs                  # the whole journey
 *   node scripts/va-shadow-live.mjs --keep           # leave the agent in place
 *   node scripts/va-shadow-live.mjs --postwait=420   # seconds to wait for a planner tick
 *   node scripts/va-shadow-live.mjs --env=staging    # needs STAGING_TESTSTATE_URL
 *   node scripts/va-shadow-live.mjs --expect-drafts  # this run HAS an item that must stage
 *
 * Env: TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID + the JIRA_* trio.
 * NOTHING secret is printed — not the trigger URL, not the Bearer, not a draft body.
 * Draft bodies are NEVER echoed (a staged message is an unsent message to a real
 * person); the script prints their SHAPE — length, sentence count, bullet count.
 */

import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { formatResultLine, resultExitCode } from "../lib/driver-report.mjs";
/* F-839 — the receipt list is READ through the lib, and the two waits STOP on a scan fault.
   `getVaStatus` answers `receipts: []` beside a named `receiptsUnavailable` when its bounded
   `va_tick:{agent}:*` prefix scan faults. `!!latest(s, phase)` cannot tell "not yet" from
   "unreadable", so both `pollStatus` calls below spun their FULL wait (TICK_WAIT_S, then
   POST_WAIT_S) against a door that had already answered, and then read the timeout as
   "no receipt appeared" — a FAIL against a product that ticked, paid for twice over. */
/* F-854 — and the SAME reader answers "is this poll ever going to end?". The prepare
   receipt already carries `worked` (the number of `va-item` tasks that were actually
   pushed, src/va-admin.js `publicReceipt`: `worked = r.staged = fannedOut`), so on a tick
   that fanned NOTHING out, `status.staged` can never rise from it — and the draft poll
   below used to spend the whole 240 s discovering that. `receiptArm` names the refusal
   arms (settling / paused / gate:*) for the same reason. */
import { newestReceipt, receiptPoll, receiptArm, unavailableNote } from "../lib/va-tick-receipt.mjs";
/* F-846 — `applyVerdict` is the ONE verdict-to-reporter dispatch in this directory
   (live-driver-scope RULE 4/F-784: a driver that writes its own `{PASS, FAIL, NV}[row.verdict]`
   map is how eight files shipped a TypeError under a green RESULT line). The two draft
   judges below return its row shape so this file never grows a ninth map. */
import { applyVerdict } from "../lib/agent-capability-precondition.mjs";

const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["agents", "jobs", "issues"], defaultEnv: "dev" });
const env = loadEnv();
const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const flag = (n) => process.argv.slice(2).includes(`--${n}`);

const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "JT");
const DESK_ID = arg("desk", "1");
const QUEUES = arg("queues", "1,2,3").split(",").filter(Boolean);
const POST_WAIT_S = Number(arg("postwait", "420"));
const TICK_WAIT_S = Number(arg("tickwait", "240"));
const KEEP = flag("keep");
/* F-846 — IS A DRAFT DUE? Only the operator knows.
   This fixture stages NOTHING of its own: it points a brand-new agent at whatever issues
   already exist in PROJECT (intake.jql `project = <PROJECT>`, desk/queues as given) and the
   drafting is two decisions deep past anything the script controls — `diffCandidates`
   (va-ledger.js) turns the sweep into candidates, and then EACH ITEM TURN asks the model,
   which may legitimately end `with nothing staged` and park the item (virtual-admin.js, the
   F-414 attempts branch). So on a healthy tenant "0 drafts" is a NORMAL outcome, not a
   defect — it means no issue in PROJECT was owed an answer the model thought worth writing.
   `--expect-drafts` is the operator asserting the opposite: that this run was set up with an
   item that MUST stage (a customer comment awaiting a reply). Only then is an empty
   `listVaDrafts` a FAIL; otherwise it is N/V with the remedy, because a precondition that
   never held is un-runnable, not broken. */
const EXPECT_DRAFTS = flag("expect-drafts");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error("\nFAIL:", m); process.exitCode = 1; throw new Error(m); };

let passes = 0; let fails = 0; let unproven = 0;
/** Set as soon as the agent exists, so the `finally` below can always remove it. */
let createdJobId = null;
const PASS = (s) => { passes++; console.log(`  PASS  ${s}`); };
const FAIL = (s) => { fails++; console.log(`  FAIL  ${s}`); };
const NV = (s) => { unproven++; console.log(`  N/V   ${s}`); };
const info = (s) => console.log(`        ${s}`);

/* ── the two transports ─────────────────────────────────────────────────────── */

/**
 * EVERY call in this script goes through here. A transient `fetch failed` once abandoned
 * a run at step 4 and left an ENABLED agent on the instance — so a network blip retries
 * rather than throwing, and `main` cleans up in a `finally` regardless.
 */
async function fetchRetry(url, init, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const t0 = Date.now();
    try { return await fetch(url, init); }
    catch (e) {
      last = e;
      // The CAUSE and the elapsed time are printed because a bare "fetch failed" is
      // unactionable: a socket reset after 30 s and a DNS failure after 20 ms are
      // different problems and only the elapsed time tells them apart.
      console.log(`        (transport retry ${i + 1}/${tries} after ${Date.now() - t0}ms: ${e.message} — ${String((e.cause && e.cause.message) || e.cause || "no cause")})`);
      await sleep(2000 * (i + 1));
    }
  }
  return { __transportError: last };
}

/**
 * A transport failure is a SOFT answer (`status: 0`), not a throw. A long poll that dies
 * on one socket must keep polling — the alternative is what happened twice while this
 * script was being written: the run aborted at step 4 and left an enabled agent behind.
 */
async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) die(`no web-trigger URL for environment "${ENV_NAME}"`);
  const res = await fetchRetry(HOOK_URL + qs, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  if (res && res.__transportError) return { status: 0, json: null, raw: `transport: ${res.__transportError.message}` };
  let text = "";
  try { text = await res.text(); }
  catch (e) { return { status: 0, json: null, raw: `body: ${e.message}` }; }
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, raw: json ? null : text.slice(0, 300) };
}

/** Invoke an ALLOW-LISTED resolver as the harness admin. A 400 here is the allow-list. */
async function invoke(functionKey, payload = {}) {
  const r = await hook({ action: "invokeResolver", functionKey, payload, accountId: ADMIN });
  return { status: r.status, body: r.json, raw: r.raw };
}

/** Read ONE KVS row through the hook's unrestricted GET read. */
async function kvs(key) {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`);
  return r.status === 200 && r.json ? r.json.value : null;
}

const AUTH = "Basic " + Buffer.from(`${requireEnv("JIRA_ADMIN_EMAIL")}:${requireEnv("JIRA_API_TOKEN")}`).toString("base64");
async function jira(path, init = {}) {
  const res = await fetchRetry(requireEnv("JIRA_BASE_URL") + path, {
    ...init,
    headers: { Authorization: AUTH, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (res && res.__transportError) return { status: 0, json: null, raw: `transport: ${res.__transportError.message}` };
  let text = "";
  try { text = await res.text(); } catch (e) { return { status: 0, json: null, raw: `body: ${e.message}` }; }
  let json = null; try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, raw: json ? null : text.slice(0, 200) };
}

/* ── THE SECOND READ: every JT issue's comment count, from TWO APIs ──────────── */

/**
 * The negative this whole run turns on is "nothing was posted", and a negative that
 * authorises a verdict must be PROVEN. So the comment count is read per issue from the
 * v3 comment API, and the script also runs a POSITIVE CONTROL on one issue (post → the
 * count moves → delete → it moves back) so the reader knows the query can see a comment
 * on these objects at all. Without the control an unchanged zero proves nothing.
 */
async function commentCounts(keys) {
  const out = {};
  for (const k of keys) {
    const r = await jira(`/rest/api/3/issue/${k}/comment?maxResults=1`);
    out[k] = r.status === 200 && r.json ? Number(r.json.total) : `ERR:${r.status}`;
  }
  return out;
}

async function issueKeysInProject(project) {
  const r = await jira(`/rest/api/3/search/jql?jql=${encodeURIComponent(`project = ${project} ORDER BY created DESC`)}&maxResults=100&fields=summary`);
  if (r.status !== 200) die(`could not list ${project} issues: ${r.status}`);
  return (r.json.issues || []).map((i) => i.key);
}

async function positiveControl(issueKey, before) {
  const post = await jira(`/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    body: JSON.stringify({ body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "cognirunner harness positive control (deleted immediately)" }] }] } }),
  });
  if (post.status !== 201) { NV(`positive control could not post on ${issueKey} (${post.status}) — the unchanged count below is therefore weaker evidence`); return false; }
  const mid = await commentCounts([issueKey]);
  const del = await jira(`/rest/api/3/issue/${issueKey}/comment/${post.json.id}`, { method: "DELETE" });
  const after = await commentCounts([issueKey]);
  const moved = Number(mid[issueKey]) === Number(before) + 1;
  const restored = Number(after[issueKey]) === Number(before);
  if (moved && restored && del.status === 204) {
    PASS(`positive control on ${issueKey}: ${before} → ${mid[issueKey]} → ${after[issueKey]} (the query CAN see a comment on this object)`);
    return true;
  }
  FAIL(`positive control on ${issueKey} did not round-trip: ${before} → ${mid[issueKey]} → ${after[issueKey]}, delete=${del.status}`);
  return false;
}

/* ── the VA record ──────────────────────────────────────────────────────────── */

const PERSONA = arg("persona", "Nadia");

const vaRecord = () => ({
  persona: {
    name: PERSONA,
    voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" },
    signature: false,
  },
  scope: { read: { site: false, projects: [PROJECT] }, write: { projects: [PROJECT] } },
  intake: {
    serviceDesks: [{ serviceDeskId: DESK_ID, queueIds: QUEUES }],
    jql: `project = ${PROJECT}`,
    mentionsOf: [],
    owedFirst: true,
  },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  // replyInternal ONLY. Nothing that can assign, transition, edit a field, reach
  // Confluence, git or the web — so the only outward act this agent has is a staged
  // internal note, and shadow mode is the only thing between it and the issue.
  powers: {
    replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false,
    confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [],
  },
  guardrails: {
    capsPerHour: 6, capsPerDay: 20, owedPerHour: 12,
    shadowTicks: 3, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20,
    approvalProjectKey: "", maxItemsPerTick: 5, maxWritesPerRun: 10,
  },
  status: { paused: false, shadowUntilTick: 3 },
});

/* ── receipts ───────────────────────────────────────────────────────────────── */

/* The local `receiptsOf`/`latest` pair is DELETED. `newestReceipt` returns
   `{receipt, unavailable}` so the four read sites below can tell an UNREAD ledger from an
   empty one, and `receiptPoll` makes "the scan faulted" a reason to STOP waiting. */

async function pollStatus(jobId, predicate, seconds, label) {
  const deadline = Date.now() + seconds * 1000;
  let last = null;
  while (Date.now() < deadline) {
    const r = await invoke("getVaStatus", { jobId });
    last = r.body && r.body.success ? r.body : null;
    if (last && predicate(last)) return last;
    await sleep(6000);
  }
  info(`(${label}: gave up after ${seconds}s)`);
  return last;
}

/*
 * F-854 — THE DRAFT POLL, WHICH STOPS AS SOON AS THE ANSWER IS KNOWN.
 *
 * `pollStatus(jobId, (s) => Number(s.staged) >= 1, ...)` could only ever stop on the
 * POSITIVE, so a run where nothing was going to stage burned the whole TICK_WAIT_S to learn
 * what the prepare receipt had already said. The decision is `judgeDraftPollStop` (pure,
 * proved offline); this function is only the loop and the clock around it, which is why the
 * measurement below is about the DECISION and not about this.
 *
 * The receipt is read through lib/va-tick-receipt.mjs on EVERY iteration rather than taken
 * once from the caller: a receipt that has not landed yet is the genuine "not yet", and the
 * arm/worked answer is only worth acting on once there is one.
 */
async function pollForDraft(jobId, seconds, label) {
  const t0 = Date.now();
  const deadline = t0 + seconds * 1000;
  let last = null;
  let reads = 0;
  let decision = { stop: false, outcome: "no-status", reason: "getVaStatus never answered a status body, so nothing about whether a draft was staged was read at all" };
  while (Date.now() < deadline) {
    const r = await invoke("getVaStatus", { jobId });
    last = r.body && r.body.success ? r.body : null;
    reads++;
    if (last) {
      const { receipt, unavailable } = newestReceipt(last, "prepare");
      decision = judgeDraftPollStop({ staged: last.staged, receipt, unavailable, arm: receiptArm(receipt) });
      if (decision.stop) {
        info(`(${label}: ANSWERED after ${reads} read(s) in ${Math.round((Date.now() - t0) / 1000)}s — ${decision.outcome}: ${decision.reason})`);
        return { status: last, decision, reads, elapsedS: Math.round((Date.now() - t0) / 1000) };
      }
    }
    await sleep(6000);
  }
  info(`(${label}: gave up after ${seconds}s — ${decision.outcome}: ${decision.reason})`);
  return { status: last, decision, reads, elapsedS: Math.round((Date.now() - t0) / 1000) };
}

/* ── the draft precondition, judged once (F-846) ─────────────────────────────
 *
 * STEP 6 used to grade F-414 with `else if (!drafts2.length) FAIL("no drafts remain after
 * the second tick, so F-414 could not be judged")`. That sentence IS an N/V — it says the
 * thing could not be judged — and it fired on exactly the run where STEP 3 had already
 * FAILED for the same missing drafts. One un-runnable precondition, two red rows, and a
 * reader counting reds would have opened two investigations into a tenant that simply had
 * nothing owed. So the rule is: ONE CAUSE, ONE VERDICT, and the step that discovered the
 * cause is the step that reports it.
 *
 * Both judges are PURE and live here rather than in lib/va-tick-receipt.mjs, which is the
 * RECEIPT library (RULE 6) and owns nothing about drafts. They are exercised offline by
 * scripts/va-shadow-draft-precondition.test.mjs.
 */

/**
 * STEP 3's verdict on "did anything stage?", plus whether STEP 6 can judge F-414 at all.
 *
 * @param {{expectedToStage: boolean, drafts: any[], detail?: string,
 *           causeAlreadyReported?: boolean}} input
 * @returns {{staged: boolean, count: number, stage: {verdict: string, what: string}|null,
 *            f414: {verdict: string, what: string}|null}}
 *   `f414` is non-null ONLY when the precondition never held — it is STEP 6's whole row in
 *   that case, and it is an N/V that NAMES step 3 so the two rows read as one story.
 *
 *   F-854 — `stage` is NULL when `causeAlreadyReported` says an EARLIER row in this same
 *   step already owns the cause (today: `judgeSweepPrecondition` found the sweep empty, so
 *   "nothing staged" is not a second fact, it is the same one restated). One cause, one
 *   verdict is F-846's rule, and it does not stop applying because the cause moved one row
 *   up. The `f414` hand-off is unaffected: step 6 must still be told it may not judge.
 */
export function judgeDraftPrecondition({ expectedToStage = false, drafts = [], detail = "", causeAlreadyReported = false } = {}) {
  const count = Array.isArray(drafts) ? drafts.length : 0;
  if (count > 0) {
    return {
      staged: true,
      count,
      stage: { verdict: "PASS", what: `listVaDrafts: ${count} staged draft(s)` },
      f414: null,
    };
  }
  const tail = detail ? ` (${detail})` : "";
  const stage = causeAlreadyReported ? null : (expectedToStage
    ? {
      verdict: "FAIL",
      what: `listVaDrafts returned no staged draft, and --expect-drafts says this run was set up with an item that MUST stage${tail}`,
    }
    : {
      verdict: "N/V",
      what: "nothing staged on this tick, and nothing in this fixture is REQUIRED to stage — "
        + "the agent sweeps the issues that already exist and each item turn may end with nothing staged. "
        + `Remedy: leave an issue owed a reply (a customer comment with no answer after it) in the swept project and re-run with --expect-drafts${tail}`,
    });
  return {
    staged: false,
    count: 0,
    stage,
    f414: {
      verdict: "N/V",
      what: "F-414 was not judged: no draft was staged on the first tick (reported in step 3), "
        + "so there was no staged item for a second tick to re-stage",
    },
  };
}

/* ── THE DRAFT POLL'S STOP CONDITION (F-854) ─────────────────────────────────
 *
 * `pollStatus(jobId, (s) => Number(s.staged) >= 1, TICK_WAIT_S, "first staged draft")`
 * had exactly ONE stop condition — the positive one — so every run where nothing was ever
 * going to stage paid the FULL `TICK_WAIT_S` (240 s) to arrive at an answer the prepare
 * receipt, read a dozen lines above, had ALREADY GIVEN. That is the same shape as F-839's
 * two spinning waits: a predicate that cannot tell "not yet" from "never", against a door
 * that has already answered.
 *
 * WHAT THE RECEIPT ALREADY KNOWS. `runVaTick` (src/virtual-admin.js) pushes one `va-item`
 * task per candidate it fans out and counts them in `fannedOut`; `recordTick` stores that
 * as `staged`, and `publicReceipt` (src/va-admin.js:~761) projects it as `worked`, beside
 * `swept` (= `candidates`) and the `skipped[]` rows for every candidate that did NOT make
 * it. `status.staged` counts STAGED DRAFTS, which only an item TURN can create. So:
 *
 *   worked === 0  ⇒  no `va-item` task exists for this tick  ⇒  `staged` CANNOT rise from
 *                    it, no matter how long the poll waits. The answer is KNOWN, negatively.
 *   worked >= 1   ⇒  turns are in flight and each may legitimately end with nothing staged
 *                    (the F-414 attempts branch) — this is the ONLY case that must wait.
 *
 * The three other known answers stop too: `staged >= 1` (the positive), a receipt whose arm
 * is a refusal (settling / paused / gate:*) — the tick never reached the sweep at all — and
 * `receiptsUnavailable`, which is F-832's N/V and never a reason to keep asking.
 *
 * NOT A STOP: no receipt yet. That is the genuine "not yet", and it is what the wait is for.
 *
 * PURE, and ARM/RECEIPT COME IN ALREADY READ — the caller takes them from
 * lib/va-tick-receipt.mjs (live-driver-scope RULE 6: the receipt list has ONE reader), which
 * also keeps this function importable by the offline test with no lib in scope.
 */

/**
 * @param {{staged: number, receipt: any, unavailable: string|null, arm: string|null}} input
 * @returns {{stop: boolean, outcome: string, reason: string}} — `outcome` is one of
 *   `"staged"` | `"unavailable"` | `"gated"` | `"nothing-swept"` | `"all-skipped"` |
 *   `"no-receipt-yet"` | `"waiting"`. Only the last two leave `stop` false.
 */
export function judgeDraftPollStop({ staged = 0, receipt = null, unavailable = null, arm = null } = {}) {
  const n = Number(staged);
  if (Number.isFinite(n) && n >= 1) {
    return { stop: true, outcome: "staged", reason: `status.staged=${n} — a draft is staged, which is the answer this poll is waiting for` };
  }
  /* F-832, in the waiting form: a door that has said it cannot read its own ledger will keep
     saying it, and the timeout would then be read as "nothing staged" rather than "unread". */
  if (unavailable) {
    return { stop: true, outcome: "unavailable", reason: `the prepare receipt could not be READ (receiptsUnavailable="${unavailable}") — whether anything was fanned out is unknown, so waiting only spends the wait to reach the same N/V` };
  }
  if (!receipt || typeof receipt !== "object") {
    return { stop: false, outcome: "no-receipt-yet", reason: "no prepare receipt has been written yet — this is the genuine 'not yet', and it is what the wait exists for" };
  }
  if (arm && arm !== "prepare") {
    return { stop: true, outcome: "gated", reason: `the tick was refused before it swept anything (arm=${arm}) — no va-item task was pushed, so status.staged cannot rise from this tick` };
  }
  /* `Number(null)` is 0 and `Number(undefined)` is NaN, so a bare `Number()` would read a
     MISSING `worked` as "nothing was fanned out" and stop the poll on a surface that changed
     under us. An absent count is not a zero count. */
  const worked = receipt.worked == null ? NaN : Number(receipt.worked);
  if (!Number.isFinite(worked)) {
    return { stop: false, outcome: "waiting", reason: `the receipt carries no usable worked count (worked=${JSON.stringify(receipt.worked)}) — nothing here says the poll may stop` };
  }
  if (worked === 0) {
    const swept = receipt.swept == null ? NaN : Number(receipt.swept);
    const skips = Array.isArray(receipt.skipped) ? receipt.skipped.filter((r) => r && typeof r === "object") : [];
    const reasons = skips.map((r) => String(r.gate || r.reason || "?"));
    const tail = reasons.length ? ` (skipped: ${JSON.stringify(reasons).slice(0, 200)})` : " (and skipped[] is empty)";
    if (Number.isFinite(swept) && swept >= 1) {
      return { stop: true, outcome: "all-skipped", reason: `the tick swept ${swept} candidate(s) and fanned out NONE of them${tail} — no va-item task was pushed, so status.staged cannot rise from this tick` };
    }
    return { stop: true, outcome: "nothing-swept", reason: `the sweep found nothing to work (swept=${JSON.stringify(receipt.swept)}, worked=0)${tail} — there is no item turn to wait for` };
  }
  return { stop: false, outcome: "waiting", reason: `${worked} item turn(s) were fanned out and none has staged yet — each turn may still end with nothing staged, so this is the one case that must wait` };
}

/* ── THE SWEEP, JUDGED BY THE SAME PRECONDITION RULE (F-854 / F-846) ──────────
 *
 * `if (Number(prep.swept) >= 1) PASS(…); else FAIL("the sweep found nothing: swept=…")`
 * is an N/V graded RED, for the same reason F-846's empty `listVaDrafts` was: this fixture
 * points a brand-new agent at WHATEVER ISSUES ALREADY EXIST in PROJECT. A project that is
 * empty, or whose issues are all already tracked, sweeps zero candidates and that is a
 * NORMAL tenant state, not a product defect. Only `--expect-drafts` — the operator asserting
 * this run was set up with an item that must stage — makes an empty sweep a real FAIL.
 *
 * ONE CAUSE, ONE VERDICT (F-846's rule). When the sweep found nothing, THIS row owns the
 * cause and `judgeDraftPrecondition` is told so: the "nothing staged" row underneath would
 * be a second verdict for the same single fact, which is exactly the two-reds shape F-846
 * was raised to remove.
 */

/**
 * @param {{expectedToStage: boolean, swept: any, detail?: string}} input
 * @returns {{found: boolean|null, row: {verdict: string, what: string}}} — `found === null`
 *   when the receipt carried no usable count, which is not a statement about the sweep.
 */
export function judgeSweepPrecondition({ expectedToStage = false, swept = null, detail = "" } = {}) {
  /* Same trap as the poll's `worked`: `Number(null)` is 0, and a receipt that carries NO
     swept count must never be graded as a sweep that found nothing — least of all as a FAIL
     under --expect-drafts, where a missing field would become evidence against the product. */
  const n = swept == null ? NaN : Number(swept);
  const tail = detail ? ` (${detail})` : "";
  if (!Number.isFinite(n)) {
    return {
      found: null,
      row: { verdict: "N/V", what: `the prepare receipt carries no usable swept count (swept=${JSON.stringify(swept)}) — the sweep was not measured, so neither a PASS nor a FAIL is available${tail}` },
    };
  }
  if (n >= 1) return { found: true, row: { verdict: "PASS", what: `swept ≥ 1: swept=${n}` } };
  if (expectedToStage) {
    return {
      found: false,
      row: { verdict: "FAIL", what: `the sweep found nothing: swept=0, and --expect-drafts says this run was set up with an item that MUST stage${tail}` },
    };
  }
  return {
    found: false,
    row: {
      verdict: "N/V",
      what: "the sweep found nothing: swept=0 — this fixture sweeps whatever issues ALREADY EXIST in the project, "
        + "so an empty or fully-tracked project sweeps zero candidates and nothing in this run REQUIRED otherwise. "
        + `Remedy: leave an issue owed a reply in the swept project and re-run with --expect-drafts${tail}`,
    },
  };
}

/**
 * STEP 6's verdict when the precondition DID hold — i.e. step 3 staged `stagedBefore`
 * drafts and the second tick has just been read. An empty `drafts` here is NOT the
 * precondition; it means drafts that existed have gone, which is a real product event and
 * keeps its FAIL.
 *
 * @param {{stagedBefore: number, drafts: any[], unchanged: boolean}} input
 * @returns {{verdict: string, what: string}|null} — null when the per-draft loop has
 *   already reported every field that moved, so nothing is said twice.
 */
export function judgeRestageEvidence({ stagedBefore = 0, drafts = [], unchanged = true } = {}) {
  const count = Array.isArray(drafts) ? drafts.length : 0;
  if (count === 0) {
    return {
      verdict: "FAIL",
      what: `the ${stagedBefore} draft(s) staged on the first tick are GONE after the second tick — `
        + "a staged item must survive a re-tick untouched (F-414)",
    };
  }
  if (!unchanged) return null;
  return {
    verdict: "PASS",
    what: "every previously staged item is unchanged — same stagedAt, same attempts",
  };
}

/* ── the body shape, never the body ─────────────────────────────────────────── */

const shapeOf = (body) => {
  const t = String(body || "");
  const bullets = (t.match(/^\s*[-*•]\s+/gm) || []).length;
  const emDash = (t.match(/—/g) || []).length;
  const sentences = (t.split(/[.!?]+\s|\n/).filter((s) => s.trim().length > 1) || []).length;
  return { chars: t.length, lines: t.split("\n").length, bullets, emDash, sentences };
};

/* ── the journey ────────────────────────────────────────────────────────────── */

async function main() {
  console.log(`\nVIRTUAL ADMINISTRATOR — live shadow-mode proof on ${ENV_NAME.toUpperCase()}, project ${PROJECT}, desk ${DESK_ID}\n`);

  const ping = await hook(null, "GET");
  if (ping.status !== 200) die(`the dev hook is not reachable / the secret was rejected (GET → ${ping.status}). Rotating HARNESS_SECRET needs a redeploy of ${ENV_NAME}.`);
  PASS(`dev hook reachable on ${ENV_NAME}, secret accepted`);

  /* ── STEP 0 — a clean floor ──────────────────────────────────────────────── */
  const pre = await invoke("listVaAgents", {});
  if (!(pre.body && pre.body.success)) die(`listVaAgents refused: ${JSON.stringify(pre.body)}`);
  info(`listVaAgents before: ${pre.body.agents.length} agent(s), unconfigured=${pre.body.unconfigured}`);

  /* ── STEP 1 — the catalogue, through the save path ───────────────────────── */
  console.log("\nSTEP 1 — the catalogue (JT desk + queues), proven through the save path");
  console.log("  NOTE: `vaCatalog` is not on the hook's allow-list. `saveScheduledJob`'s mode:\"va\" arm");
  console.log("        calls vaAdmin.catalog() itself and drops anything the catalogue does not know,");
  console.log("        so a save that KEEPS desk/queues is the catalogue having seen them.");

  /* ── STEP 2 — create the agent ───────────────────────────────────────────── */
  console.log("\nSTEP 2 — create the Virtual Administrator");
  const created = await invoke("saveScheduledJob", {
    job: { name: `VA proof — ${PERSONA}`, mode: "va", enabled: true, va: vaRecord() },
  });
  if (!(created.body && created.body.success)) die(`saveScheduledJob refused: ${JSON.stringify(created.body).slice(0, 500)}`);
  const job = created.body.job;
  const jobId = job.id;
  createdJobId = jobId;
  const refused = created.body.refused || [];
  PASS(`agent created: ${jobId} name="${job.name}" mode=${job.mode} cron="${job.schedule.cron}" tz=${job.schedule.timeZone}`);
  info(`refused[] (${refused.length}): ${refused.length ? JSON.stringify(refused) : "none"}`);
  const cat = refused.filter((r) => String(r.field || "").startsWith("catalogue."));
  if (cat.length) FAIL(`a catalogue source could not be read: ${JSON.stringify(cat)}`);
  else PASS("no catalogue.* refusal — every catalogue source (projects, desks, queues, zones, skills) was read live");
  const savedDesks = JSON.stringify(job.va.intake.serviceDesks);
  if (savedDesks === JSON.stringify([{ serviceDeskId: DESK_ID, queueIds: QUEUES }])) PASS(`intake kept desk ${DESK_ID} with queues ${QUEUES.join("/")} — the live catalogue contains them`);
  else FAIL(`intake was rewritten by the catalogue check: ${savedDesks}`);
  info(`scope.read=${JSON.stringify(job.va.scope.read)} scope.write=${JSON.stringify(job.va.scope.write)}`);
  info(`powers=${JSON.stringify(job.va.powers)}`);
  info(`guardrails.shadowTicks=${job.va.guardrails.shadowTicks} status.shadowUntilTick=${job.va.status.shadowUntilTick} minPostGapMinutes=${job.va.guardrails.minPostGapMinutes}`);
  if (job.va.status.shadowUntilTick >= 3) PASS(`shadow mode armed: shadowUntilTick=${job.va.status.shadowUntilTick}`);
  else FAIL(`shadow mode NOT armed: shadowUntilTick=${job.va.status.shadowUntilTick}`);

  const agents = await invoke("listVaAgents", {});
  const mine = (agents.body.agents || []).find((a) => a.id === jobId);
  if (mine) PASS(`listVaAgents sees it: ${JSON.stringify(mine).slice(0, 220)}`);
  else FAIL("listVaAgents does not list the agent that was just created");

  /* ── the BEFORE read ─────────────────────────────────────────────────────── */
  console.log("\nBASELINE — every JT issue's comment count, and the positive control");
  const keys = await issueKeysInProject(PROJECT);
  info(`${PROJECT} issues: ${keys.length} — ${keys.join(", ")}`);
  const before = await commentCounts(keys);
  info(`comment counts before: ${JSON.stringify(before)}`);
  await positiveControl(keys[0], before[keys[0]]);

  /* ── STEP 3 — the PREPARE tick ───────────────────────────────────────────── */
  console.log("\nSTEP 3 — run the prepare tick (runScheduledJobNow → enqueueJobRun → isVaJob → va-tick)");
  const ran = await invoke("runScheduledJobNow", { id: jobId });
  if (!(ran.body && ran.body.success)) die(`runScheduledJobNow refused: ${JSON.stringify(ran.body)}`);
  PASS(`va-tick enqueued, taskId=${ran.body.taskId}`);

  const afterTick = await pollStatus(jobId, (s) => receiptPoll(s, "prepare").stop, TICK_WAIT_S, "prepare receipt");
  const { receipt: prep, unavailable: prepUnavailable } = newestReceipt(afterTick, "prepare");
  /* F-854 — did the sweep find anything? `null` = not measured (unreadable / no receipt /
     no usable count), `false` = measured and empty, which is the cause STEP 3's draft row
     must then NOT report a second time. */
  let sweepFound = null;
  if (prepUnavailable) { NV(unavailableNote(prepUnavailable, "the prepare receipt and its swept/worked/skipped numbers")); }
  else if (!prep) { FAIL("no prepare receipt appeared within the wait"); }
  else {
    PASS(`prepare receipt: ${JSON.stringify(prep).slice(0, 600)}`);
    /* F-854 — an empty sweep on a project nobody seeded is an UN-RUNNABLE PRECONDITION, not
       a product failure; only --expect-drafts makes it red. Same judge shape, same rule and
       the same dispatch as F-846's draft row. */
    const sweep = judgeSweepPrecondition({ expectedToStage: EXPECT_DRAFTS, swept: prep.swept, detail: `worked=${prep.worked}` });
    sweepFound = sweep.found;
    applyVerdict(sweep.row, { PASS, FAIL, NV });
    info(`worked (fanned out)=${prep.worked} skipped=${JSON.stringify(prep.skipped || []).slice(0, 400)}`);
  }
  info(`status: itemsByState=${JSON.stringify(afterTick && afterTick.itemsByState)} staged=${afterTick && afterTick.staged} health=${JSON.stringify(afterTick && afterTick.health)} shadow=${JSON.stringify(afterTick && afterTick.shadow)}`);

  /* The item turns are separate tasks, so a draft can only arrive later than the receipt —
     but F-854: the receipt already says whether any turn was FANNED OUT at all, and when it
     says none was, there is nothing to wait for. `pollForDraft` stops on that, on the
     positive, on a refusal arm and on an unreadable ledger; only "turns are in flight"
     spends the wait. */
  const draftPoll = await pollForDraft(jobId, TICK_WAIT_S, "first staged draft");
  const dr = await invoke("listVaDrafts", { jobId });
  const drafts = (dr.body && dr.body.drafts) || [];
  /* F-846 — the precondition is judged ONCE, here, and step 6 is told what it may judge.
     F-854 — …unless the empty SWEEP above already reported that same single cause, in which
     case this row is suppressed and only step 6's hand-off survives. The poll's own stop
     reason rides in `detail`, so the row names WHY the run stopped waiting. */
  const draftPrecondition = judgeDraftPrecondition({
    expectedToStage: EXPECT_DRAFTS,
    drafts,
    causeAlreadyReported: sweepFound === false,
    detail: `poll stopped on ${draftPoll.decision.outcome} after ${draftPoll.elapsedS}s; ${JSON.stringify(dr.body).slice(0, 200)}`,
  });
  if (draftPrecondition.stage) applyVerdict(draftPrecondition.stage, { PASS, FAIL, NV });
  if (draftPrecondition.staged) {
    for (const d of drafts) {
      const sh = shapeOf(d.body);
      const prose = sh.bullets === 0;
      console.log(`        draft ${d.itemKey}: audience="${d.audience}" attempts=${d.attempts} stagedAt=${d.stagedAt} shape=${JSON.stringify(sh)}`);
      if (d.audience === "internal") PASS(`  ${d.itemKey}: audience is internal`);
      else FAIL(`  ${d.itemKey}: audience is "${d.audience}", not internal`);
      if (prose) PASS(`  ${d.itemKey}: plain prose — 0 bullet lines`);
      else FAIL(`  ${d.itemKey}: ${sh.bullets} bullet line(s) in the body`);
    }
  }

  // The ROW itself, straight from KVS, so the resolver's answer has a second source.
  for (const d of drafts.slice(0, 3)) {
    const row = await kvs(`va_item:${jobId}:${d.itemKey}`);
    if (row) info(`va_item:${jobId}:${d.itemKey} → state=${row.state} attempts=${row.attempts} staged.audience=${row.staged && row.staged.audience} staged.tickId=${row.staged && row.staged.tickId} historyLen=${(row.history || []).length}`);
    else FAIL(`the KVS row va_item:${jobId}:${d.itemKey} could not be read`);
  }

  const attemptsBefore = Object.fromEntries(drafts.map((d) => [d.itemKey, d.attempts]));
  const stagedAtBefore = Object.fromEntries(drafts.map((d) => [d.itemKey, d.stagedAt]));

  /* ── STEP 4 — the POST phase, and the proof that nothing was posted ──────── */
  console.log("\nSTEP 4 — the post phase (the REAL 5-minute planner enqueues va-post; runVaPostNow is not allow-listed)");
  const postStatus = await pollStatus(jobId, (s) => receiptPoll(s, "post").stop, POST_WAIT_S, "post receipt");
  const { receipt: post, unavailable: postUnavailable } = newestReceipt(postStatus, "post");
  if (postUnavailable) {
    /* The comment-count read below is a DIFFERENT door (Jira's own) and still stands as the
       proof that nothing was posted; what is unproven here is the receipt's own account. */
    NV(unavailableNote(postUnavailable, "the post receipt, its posted count and whether skipped[] names the shadow gate"));
  } else if (!post) {
    FAIL(`no post receipt within ${POST_WAIT_S}s — the post phase could not be observed`);
  } else {
    PASS(`post receipt: ${JSON.stringify(post).slice(0, 600)}`);
    const sk = post.skipped || [];
    const shadowRows = sk.filter((r) => String(r.reason || "").includes("shadow"));
    if (Number(post.posted) === 0) PASS("the post receipt reports 0 posted");
    else FAIL(`the post receipt reports ${post.posted} posted`);
    if (shadowRows.length) PASS(`skipped[] names the shadow gate: ${JSON.stringify(shadowRows)}`);
    else FAIL(`skipped[] does not name the shadow gate: ${JSON.stringify(sk).slice(0, 400)}`);
  }

  console.log("\n  THE SECOND READ — every JT issue's comment count, after the post phase");
  const after = await commentCounts(keys);
  const moved = keys.filter((k) => String(before[k]) !== String(after[k]));
  if (!moved.length) PASS(`no comment count changed on any of the ${keys.length} ${PROJECT} issues: ${JSON.stringify(after)}`);
  else FAIL(`comment counts CHANGED on ${JSON.stringify(moved)} — before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);

  const effects = await invoke("listVaEffects", { jobId });
  const eff = (effects.body && effects.body.effects) || [];
  if (eff.length === 0) PASS("listVaEffects is empty — no effect row was written, which is what gate 11 guarantees when nothing was posted");
  else FAIL(`listVaEffects has ${eff.length} row(s): ${JSON.stringify(eff).slice(0, 400)}`);

  /* ── STEP 6 — F-414: a second tick does not re-stage ─────────────────────── */
  console.log("\nSTEP 6 — F-414: a second prepare tick must not re-stage the same item");
  const ran2 = await invoke("runScheduledJobNow", { id: jobId });
  if (!(ran2.body && ran2.body.success)) FAIL(`the second run-now refused: ${JSON.stringify(ran2.body)}`);
  else info(`second va-tick enqueued, taskId=${ran2.body.taskId}`);
  await sleep(45000);
  const st2 = await invoke("getVaStatus", { jobId });
  const { receipt: prep2, unavailable: prep2Unavailable } = newestReceipt(st2.body, "prepare");
  info(`second prepare receipt: ${JSON.stringify(prep2).slice(0, 500)}${prep2Unavailable ? ` (UNREADABLE: receiptsUnavailable="${prep2Unavailable}")` : ""}`);
  const dr2 = await invoke("listVaDrafts", { jobId });
  const drafts2 = (dr2.body && dr2.body.drafts) || [];
  info(`drafts after the second tick: ${drafts2.length}`);
  let f414 = true;
  for (const d of drafts2) {
    const wasAttempts = attemptsBefore[d.itemKey];
    const wasStagedAt = stagedAtBefore[d.itemKey];
    if (wasAttempts === undefined) continue;
    if (d.attempts !== wasAttempts) { FAIL(`  ${d.itemKey}: attempts moved ${wasAttempts} → ${d.attempts}`); f414 = false; }
    if (d.stagedAt !== wasStagedAt) { FAIL(`  ${d.itemKey}: the draft was RE-STAGED (stagedAt ${wasStagedAt} → ${d.stagedAt})`); f414 = false; }
  }
  /* F-846 — when NOTHING ever staged, step 3 already owns that row and this step says only
     that F-414 was not judgeable. When drafts DID stage and are now gone, that is a product
     event of its own and keeps its FAIL. */
  if (draftPrecondition.f414) {
    applyVerdict(draftPrecondition.f414, { PASS, FAIL, NV });
  } else {
    const row = judgeRestageEvidence({ stagedBefore: drafts.length, drafts: drafts2, unchanged: f414 });
    /* The evidence rides in `what` rather than in applyVerdict's `detail`, because these three
       reporters take ONE string and a second argument would be silently dropped. */
    if (row) applyVerdict({ ...row, what: `${row.what} (${JSON.stringify(drafts2.map((d) => ({ k: d.itemKey, a: d.attempts })))})` }, { PASS, FAIL, NV });
  }

  /* ── STEP 5 — pause ──────────────────────────────────────────────────────── */
  console.log("\nSTEP 5 — pause the agent (saveScheduledJob status.paused; `pauseVa` is not allow-listed)");
  const cur = await invoke("getScheduledJob", { id: jobId });
  const curJob = cur.body && cur.body.job;
  const paused = await invoke("saveScheduledJob", { job: { ...curJob, va: { ...curJob.va, status: { ...curJob.va.status, paused: true } } } });
  if (!(paused.body && paused.body.success)) FAIL(`the pause save refused: ${JSON.stringify(paused.body).slice(0, 300)}`);
  else if (paused.body.job.va.status.paused === true) PASS("status.paused = true is persisted on the record");
  else FAIL(`status.paused did not persist: ${JSON.stringify(paused.body.job.va.status)}`);

  const ran3 = await invoke("runScheduledJobNow", { id: jobId });
  info(`run-now on a paused agent: ${JSON.stringify(ran3.body).slice(0, 200)}`);
  await sleep(40000);
  const st3 = await invoke("getVaStatus", { jobId });
  const { receipt: prep3, unavailable: prep3Unavailable } = newestReceipt(st3.body, "prepare");
  info(`prepare receipt after the pause: ${JSON.stringify(prep3).slice(0, 400)}${prep3Unavailable ? ` (UNREADABLE: receiptsUnavailable="${prep3Unavailable}")` : ""}`);
  if (st3.body && st3.body.paused === true) PASS("getVaStatus reports paused = true");
  else FAIL(`getVaStatus reports paused = ${st3.body && st3.body.paused}`);
  const pausedSkip = (prep3 && (prep3.skipped || []).some((r) => String(r.reason) === "paused"));
  if (prep3Unavailable) NV(unavailableNote(prep3Unavailable, "whether the tick after the pause RECORDS the pause (a paused tick records skipped[{reason:\"paused\"}], so its absence here would be read as the engine ignoring the pause)"));
  else if (pausedSkip) PASS(`the tick receipt says paused: ${JSON.stringify(prep3.skipped)}`);
  else FAIL(`the tick after the pause does not say paused: ${JSON.stringify(prep3 && prep3.skipped).slice(0, 300)}`);

  /* ── the agent's memory ──────────────────────────────────────────────────── */
  const mem = await invoke("getVaMemory", { jobId });
  info(`getVaMemory: ${JSON.stringify(mem.body).slice(0, 300)}`);

  /* ── STEP 7 — delete and confirm ─────────────────────────────────────────── */
  if (KEEP) { console.log("\nSTEP 7 — SKIPPED (--keep). The agent is PAUSED and still on the instance."); }
  else {
    console.log("\nSTEP 7 — delete the agent and confirm the instance is as it was");
    const del = await invoke("deleteScheduledJob", { id: jobId });
    if (del.body && del.body.success) PASS(`deleteScheduledJob: ${JSON.stringify(del.body).slice(0, 200)}`);
    else FAIL(`deleteScheduledJob refused: ${JSON.stringify(del.body).slice(0, 300)}`);
    const postDel = await invoke("listVaAgents", {});
    const still = ((postDel.body && postDel.body.agents) || []).find((a) => a.id === jobId);
    if (!still) PASS(`listVaAgents no longer lists it (${(postDel.body.agents || []).length} agent(s) left)`);
    else FAIL(`listVaAgents still lists ${jobId}`);
    // The LEDGER rows are NOT deleted by the job delete — say so rather than assume it.
    const leftovers = [];
    for (const d of drafts) {
      const row = await kvs(`va_item:${jobId}:${d.itemKey}`);
      if (row) leftovers.push(d.itemKey);
    }
    info(`va_item rows still present after the job delete: ${leftovers.length ? leftovers.join(", ") : "none"} (there is no cleanup op in va-admin.js; the rows carry their own TTL)`);
    const finalCounts = await commentCounts(keys);
    if (JSON.stringify(finalCounts) === JSON.stringify(before)) PASS(`${PROJECT} comment counts are byte-identical to the baseline: ${JSON.stringify(finalCounts)}`);
    else FAIL(`${PROJECT} changed: before ${JSON.stringify(before)} now ${JSON.stringify(finalCounts)}`);
  }

  console.log("\n" + formatResultLine({ passes, fails, unproven }));
  if (resultExitCode({ fails })) process.exitCode = 1;
}

/**
 * THE CLEANUP GUARANTEE. `createdJobId` is set the moment the agent exists, and the
 * `finally` deletes it whatever happened above — an exception in the middle of the
 * journey must never leave an ENABLED Virtual Administrator ticking on a live site.
 *
 * AND THE GUARANTEE IS PROVEN, NOT ASSUMED. Two traps this block used to walk into:
 *  - a `listVaAgents` call that THREW was caught to `null`, which read as "not listed",
 *    which read as "already gone" — a blind query licensing a silent exit. An absence is
 *    only evidence when the query is known to be able to see the object;
 *  - `deleteScheduledJob`'s own `success:true` was the last word. It is the writer's
 *    opinion of its own write, so the row is now RE-READ through `getScheduledJob`.
 * A survivor exits non-zero with the phase named.
 */
main()
  .catch((e) => { console.error("\nDRIVER ERROR:", e && e.message); process.exitCode = 1; })
  .finally(async () => {
    if (!createdJobId || KEEP) return;
    const list = await invoke("listVaAgents", {}).catch(() => null);
    const listWorked = !!(list && list.body && Array.isArray(list.body.agents));
    const listed = listWorked && list.body.agents.some((a) => a.id === createdJobId);
    if (!listWorked) console.log(`\nCLEANUP — listVaAgents could not be read, so "not listed" would prove nothing; deleting ${createdJobId} regardless`);
    else if (!listed) console.log(`\nCLEANUP — listVaAgents no longer lists ${createdJobId}; confirming with a direct read`);
    else console.log(`\nCLEANUP — the run did not reach step 7; deleting ${createdJobId}`);

    if (listed || !listWorked) {
      const del = await invoke("deleteScheduledJob", { id: createdJobId }).catch((e) => ({ body: { error: String(e.message) } }));
      console.log(`        deleteScheduledJob: ${JSON.stringify(del.body).slice(0, 200)}`);
    }
    // THE SECOND READ, on the same object, through a different call than the delete.
    const back = await invoke("getScheduledJob", { id: createdJobId }).catch((e) => ({ body: { error: String(e.message) } }));
    const survives = !!(back && back.body && back.body.job);
    console.log(`        second read getScheduledJob ${createdJobId}: ${survives ? "STILL PRESENT" : "gone"}`);
    if (survives) {
      console.error(`\nCLEANUP FAILED — the Virtual Administrator ${createdJobId} is STILL on the instance after the delete. Remove it by hand (Admin → Scheduled jobs) before the next run.`);
      process.exitCode = 1;
    }
  });
