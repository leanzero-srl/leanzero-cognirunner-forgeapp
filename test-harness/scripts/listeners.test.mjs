/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for the Listener + Scheduled Job engines' PURE parts:
// validation/normalisation (the REST contract), static event matching, the
// scheduler's tick planner, and the trigger's cheap early exits against a mocked
// KVS/@forge/api. Run: node --import ../lib/register-mocks.mjs scripts/listeners.test.mjs
import { register } from "node:module";
import storage from "../lib/mock-kvs.mjs";
import forgeApi, { pushed } from "../lib/mock-forge-api.mjs";
import {
  normalizeListener, normalizeStep, matchListenerStatic, toIndexRow, listenerTrigger,
  LISTENER_INDEX_KEY, LISTENER_PREFIX, saveListener, listListeners, getListener, deleteListener, setListenerEnabled,
  BRAKE_MAX_PER_LISTENER, matchesListenerRepos, sameGitActor, isGitSelfEvent, setConnectionIdentityResolver,
  normalizeSavedByRole, brakeObjectKey, BRAKE_MAX_PER_ISSUE, mergeGitProperty, gitPropertyEntry, writeGitIssueProperty, dispatchGitEvent, gitPropertyTargets, summarizeEventForAi,
  GIT_PROPERTY_KEY, GIT_PROPERTY_MAX_REPOS, GIT_PROPERTY_MAX_BYTES,
} from "../../src/listeners.js";
import { normalizeJob, planTick, saveJob, listJobs, setJobEnabled, previewSchedule } from "../../src/scheduled-jobs.js";
import { normalizeAllowedActions, toolDefinitionsFor } from "../../src/shared/agent-actions.js";

let pass = 0; let fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("  FAIL:", msg); } };
const throws = (fn, re, msg) => { try { fn(); ok(false, `${msg} (did not throw)`); } catch (e) { ok(re.test(e.message), `${msg} — got "${e.message}"`); } };

// ── normalizeListener (REST contract) ─────────────────────────────────────────
throws(() => normalizeListener({}), /name is required/, "name required");
throws(() => normalizeListener({ name: "x", events: ["nope"] }), /events must contain/, "unknown events rejected");
throws(() => normalizeListener({ name: "x", events: ["avi:jira:created:issue"] }), /functions must contain/, "script mode needs a step");
throws(() => normalizeListener({ name: "x", events: ["avi:jira:created:issue"], mode: "agent" }), /agent.instructions is required/, "agent mode needs instructions");
throws(() => normalizeListener({ name: "x", events: ["avi:jira:commented:issue"], filters: { commentPattern: "(a+)+$" }, functions: [{ code: "1" }] }), /unsafe/, "ReDoS comment pattern rejected");
throws(() => normalizeListener({ name: "x", events: ["avi:jira:commented:issue"], filters: { commentPattern: "(" }, functions: [{ code: "1" }] }), /not a valid regex/, "broken regex rejected");
const l1 = normalizeListener({
  name: "  Escalate  ", events: ["avi:jira:commented:issue", "avi:jira:commented:issue", "bogus"],
  filters: { projectKeys: ["lzpt", " abc "], issueTypes: ["Bug"], jql: "priority = Highest", commentPattern: "urgent|asap" },
  functions: [{ name: "Step", code: "api.log(1)", variableName: "r1", secret: "dropme" }],
  agent: { allowedActions: ["add_comment", "nope", "finish"], maxRounds: 99 }, aiCondition: "is a complaint",
}, { accountId: "acc-1" });
ok(l1.id.startsWith("lst_") && l1.name === "Escalate", "id minted + name trimmed");
ok(JSON.stringify(l1.events) === JSON.stringify(["avi:jira:commented:issue"]), "events deduped + unknown dropped");
ok(JSON.stringify(l1.filters.projectKeys) === JSON.stringify(["LZPT", "ABC"]), "project keys upper-cased + trimmed");
ok(l1.functions[0].secret === undefined && l1.functions[0].variableName === "r1", "step whitelisted");
ok(JSON.stringify(l1.agent.allowedActions) === JSON.stringify(["add_comment"]) && l1.agent.maxRounds === 8, "agent actions filtered, rounds clamped");
ok(l1.enabled === true && l1.ignoreSelf === true && l1.mode === "script" && l1.createdBy === "acc-1", "defaults");
const l1b = normalizeListener({ ...l1, name: "Renamed", id: "ignored-on-update", stats: { runCount: 99 } }, { existing: { ...l1 } });
ok(l1b.id === l1.id && l1b.stats === undefined && l1b.createdBy === "acc-1" && l1b.name === "Renamed", "update keeps identity; client-sent stats are ignored (stats live in their own key)");
ok(normalizeListener({ id: "my.custom_id-1", name: "n", events: ["avi:jira:created:issue"], functions: [{ code: "1" }] }).id === "my.custom_id-1", "client id honoured when well-formed");
ok(normalizeStep({}, 2).name === "Step 3" && normalizeStep({ code: "x".repeat(30000) }).code.length === 30000, "step defaults + 30k code accepted");
throws(() => normalizeStep({ code: "x".repeat(40000) }), /exceeds 32768/, "oversized step code is an ERROR, not a silent clamp");
ok(normalizeListener({ name: "j", events: ["avi:jira:created:issue"], filters: { jql: "priority = High ORDER BY created DESC" }, functions: [{ code: "1" }] }).filters.jql === "priority = High", "trailing ORDER BY stripped from the JQL filter");

// ── matchListenerStatic ───────────────────────────────────────────────────────
const ev = (over = {}) => ({ eventType: "avi:jira:updated:issue", selfGenerated: false, issue: { id: "1", key: "LZPT-5", fields: { project: { id: "10", key: "LZPT" }, issuetype: { id: "2", name: "Bug" } } }, changelog: { items: [{ field: "priority", fieldId: "priority" }] }, ...over });
const ctxOf = (e) => ({ eventType: e.eventType, issueKey: e.issue.key, projectKey: e.issue.fields.project.key, projectId: "10", issueTypeName: e.issue.fields.issuetype.name, issueTypeId: "2", selfGenerated: e.selfGenerated === true });
const base = { enabled: true, events: ["avi:jira:updated:issue"], ignoreSelf: true, filters: {} };
ok(matchListenerStatic(base, ctxOf(ev()), ev()).ok, "bare listener matches");
ok(!matchListenerStatic({ ...base, enabled: false }, ctxOf(ev()), ev()).ok, "disabled never matches");
ok(!matchListenerStatic({ ...base, events: ["avi:jira:created:issue"] }, ctxOf(ev()), ev()).ok, "unsubscribed event");
ok(!matchListenerStatic(base, ctxOf(ev({ selfGenerated: true })), ev({ selfGenerated: true })).ok, "self-generated ignored by default");
ok(matchListenerStatic({ ...base, ignoreSelf: false }, ctxOf(ev({ selfGenerated: true })), ev({ selfGenerated: true })).ok, "self-generated allowed when opted in");
ok(matchListenerStatic({ ...base, filters: { projectKeys: ["LZPT"] } }, ctxOf(ev()), ev()).ok, "project filter hit");
ok(!matchListenerStatic({ ...base, filters: { projectKeys: ["OTHER"] } }, ctxOf(ev()), ev()).ok, "project filter miss");
ok(matchListenerStatic({ ...base, filters: { issueTypes: ["bug"] } }, ctxOf(ev()), ev()).ok, "issue type by name (case-insensitive)");
ok(matchListenerStatic({ ...base, filters: { issueTypes: ["2"] } }, ctxOf(ev()), ev()).ok, "issue type by id");
ok(!matchListenerStatic({ ...base, filters: { issueTypes: ["Task"] } }, ctxOf(ev()), ev()).ok, "issue type miss");
ok(matchListenerStatic({ ...base, filters: { changedFields: ["Priority"] } }, ctxOf(ev()), ev()).ok, "changed field hit (case-insensitive)");
ok(!matchListenerStatic({ ...base, filters: { changedFields: ["summary"] } }, ctxOf(ev()), ev()).ok, "changed field miss");
const cev = { eventType: "avi:jira:commented:issue", issue: { key: "LZPT-5", fields: { project: { key: "LZPT" } } }, comment: { body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "this is URGENT please" }] }] } } };
const cbase = { ...base, events: ["avi:jira:commented:issue"] };
ok(matchListenerStatic({ ...cbase, filters: { commentPattern: "urgent|asap" } }, { ...ctxOf(ev()), eventType: cev.eventType }, cev).ok, "comment pattern hit");
ok(!matchListenerStatic({ ...cbase, filters: { commentPattern: "^refund" } }, { ...ctxOf(ev()), eventType: cev.eventType }, cev).ok, "comment pattern miss");
// non-project-scoped events ignore the project filter
const sprintCtx = { eventType: "avi:jira-software:started:sprint", projectKey: null, selfGenerated: false };
ok(matchListenerStatic({ ...base, events: ["avi:jira-software:started:sprint"], filters: { projectKeys: ["LZPT"] } }, sprintCtx, { sprint: {} }).ok, "sprint event ignores project filter");

// ── storage round-trip (mock KVS) ─────────────────────────────────────────────
storage.__reset();
const saved = await saveListener({ name: "A", events: ["avi:jira:created:issue"], functions: [{ code: "api.log(1)" }] }, { accountId: "u" });
const saved2 = await saveListener({ name: "B", events: ["avi:jira:created:issue"], filters: { projectKeys: ["ZZZ"] }, functions: [{ code: "api.log(2)" }] }, { accountId: "u" });
ok((await listListeners()).length === 2, "two listeners listed");
ok((await getListener(saved.id)).functions[0].code === "api.log(1)", "full record read back");
ok((await storage.get(LISTENER_INDEX_KEY)).every((r) => r.functions === undefined && r.stats === undefined), "index rows are slim (no code, no stats)");
ok((await listListeners()).every((r) => r.stats && r.stats.runCount === 0), "listed rows carry merged (empty) stats");
await setListenerEnabled(saved2.id, false);
ok((await getListener(saved2.id)).enabled === false && (await listListeners()).find((r) => r.id === saved2.id).enabled === false, "disable persists to record + index");
ok((await deleteListener(saved2.id)).removed && (await listListeners()).length === 1, "delete removes both");
ok(!(await deleteListener("nope")).removed, "delete unknown is a no-op");

// ── trigger early exits (must not touch Jira or the queue) ────────────────────
forgeApi.__reset(); pushed.length = 0;
await listenerTrigger({ eventType: "avi:jira:viewed:issue", issue: { key: "LZPT-1" } }, {});
ok(forgeApi.__calls.length === 0 && pushed.length === 0, "no listener for the event → no Jira call, no enqueue");
await listenerTrigger({ eventType: "not:an:event" }, {});
ok(pushed.length === 0, "unknown event ignored");
// disabled candidate → nothing queued (index read is cached 30s; the save above invalidated it)
await saveListener({ ...(await getListener(saved.id)), enabled: false }, { accountId: "u" });
await listenerTrigger({ eventType: "avi:jira:created:issue", issue: { key: "LZPT-2", fields: {} } }, {});
ok(pushed.length === 0, "disabled listener not queued");

// ── trigger POSITIVE path: a projectScoped:false event enqueues a run ─────────
// F-006 cost a live probe because the non-issue, non-project event families (jsm, sprints,
// boards, users, fields, filters, issue types, configuration) had no offline proof at all.
// The enqueue step dynamically imports src/index.js (makeTaskId + writeAsyncJob), and that
// module cannot load offline: @forge/llm throws "Forge runtime not found" at import time and
// `export { testStateTrigger } from "./test-hook"` is extensionless (Forge bundles it, node
// does not resolve it). Map that ONE dynamic specifier — only the one listeners.js asks for —
// to a two-function stub. Registered here in the body on purpose: the hook only has to exist
// before the first listenerTrigger() call that gets as far as pushing to the queue.
const INDEX_STUB_HOOK = `
export async function resolve(spec, ctx, next) {
  if (spec === "./index.js" && String(ctx.parentURL || "").endsWith("/src/listeners.js")) return { url: "cogni-mock:index", shortCircuit: true, format: "module" };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === "cogni-mock:index") return { format: "module", shortCircuit: true, source: "let n = 0; export const makeTaskId = (p) => p + '_t' + (++n); export const writeAsyncJob = async () => {}; export const storeLog = async () => {};" };
  return next(url, ctx);
}`;
register("data:text/javascript," + encodeURIComponent(INDEX_STUB_HOOK));

const RT_EVENT = "avi:jsm-entity:created:request-type";
const rtEvent = () => ({ eventType: RT_EVENT, entityId: "10101", entityType: "request-type", activationId: "act-1" });
// NOTE: saveListener rewrites the index, which drops the trigger's 30s per-container cache —
// that is why these fire immediately. A LIVE test must wait ~35s between save and event.
storage.__reset(); forgeApi.__reset(); pushed.length = 0;
const lNoFilter = await saveListener({ name: "RT any", events: [RT_EVENT], functions: [{ code: "api.log(1)" }] }, { accountId: "u" });
await listenerTrigger(rtEvent(), {});
ok(pushed.length === 1 && pushed[0].queue === "async-ai-queue" && pushed[0].body.taskType === "listener" && pushed[0].body.params.listenerId === lNoFilter.id, "non-issue, non-project event ENQUEUES a run");
ok(pushed[0].body.params.ctx.issueKey === null && pushed[0].body.params.ctx.entityName === "request-type 10101" && pushed[0].body.params.event.activationId === "act-1", "queued ctx/payload carry the entity, not an issue");
ok(forgeApi.__calls.length === 0, "entity event resolves nothing — zero Jira REST calls from the trigger");
// A project filter must NOT gate an event Jira never scopes to a project (meta.projectScoped
// === false bypasses the project gate in BOTH the shortlist and matchListenerStatic). This is
// deliberate: gating here would make every such listener dead. It must not silently regress.
forgeApi.__reset(); pushed.length = 0;
const lProjFilter = await saveListener({ name: "RT filtered", events: [RT_EVENT], filters: { projectKeys: ["LZPT"] }, functions: [{ code: "api.log(2)" }] }, { accountId: "u" });
await listenerTrigger(rtEvent(), {});
ok(pushed.length === 2 && pushed.some((p) => p.body.params.listenerId === lProjFilter.id), "projectKeys filter does not gate a projectScoped:false event");
ok(forgeApi.__calls.length === 0, "no project-key resolution REST call either (the key could not be used anyway)");
// Brakes with no issue: the per-ISSUE loop guard is skipped (nothing to loop on), the
// per-LISTENER cost guard still applies. Record every key the trigger reads to prove it.
const readKeys = []; const realGet = storage.get;
storage.get = async (k) => { readKeys.push(String(k)); return realGet.call(storage, k); };
pushed.length = 0;
await listenerTrigger(rtEvent(), {});
storage.get = realGet;
const brakeReads = readKeys.filter((k) => k.startsWith("lst_brake:"));
ok(brakeReads.length >= 2 && brakeReads.every((k) => k.startsWith("lst_brake:L:")), "no issue key → per-issue brake never read, only per-listener brakes");
// Take the key from what the trigger actually read (it carries the 5-minute bucket) rather
// than recomputing the bucket here, which would flake across a bucket boundary.
const listenerBrakeKey = brakeReads.find((k) => k.startsWith(`lst_brake:L:${lNoFilter.id}:`));
ok(listenerBrakeKey && Number(await storage.get(listenerBrakeKey)) >= 1, "per-listener brake counts runs of a no-issue event");
storage.__seed(listenerBrakeKey, BRAKE_MAX_PER_LISTENER);
pushed.length = 0;
await listenerTrigger(rtEvent(), {});
ok(pushed.length === 1 && pushed[0].body.params.listenerId === lProjFilter.id, "per-listener brake stops the braked listener only — the cost guard applies without an issue");
// ── trigger: a GIT delivery (webhook → trigger → queue), repos + ignoreSelf ───
// Same trigger, different door: git events reach listenerTrigger from the app's own
// webhook, not from a manifest trigger. The repos allow-list is the ONLY scope they
// have, and ignoreSelf compares the actor login to the connection's cached whoami.
storage.__reset(); forgeApi.__reset(); pushed.length = 0;
const gitEvent = (over = {}) => ({
  eventType: "git:pull_request:opened", source: "git", connectionId: "gc_1",
  repoId: "LeanZero/CogniRunner", deliveryId: "d-9", actor: { login: "octocat" },
  pullRequest: { number: 7, title: "Add a thing", headSha: "abc" }, ...over,
});
const gitL = await saveListener({ name: "PR review", events: ["git:pull_request:opened"], mode: "agent", agent: { instructions: "review", allowedActions: [] }, filters: { repos: ["leanzero/cognirunner"] } }, { accountId: "u" });
setConnectionIdentityResolver(async () => ({ login: "CogniRunner[bot]" }));
await listenerTrigger(gitEvent(), {});
ok(pushed.length === 1 && pushed[0].body.params.listenerId === gitL.id, "a git delivery for an allow-listed repo enqueues a run");
ok(pushed[0].body.params.ctx.repoId === "leanzero/cognirunner" && pushed[0].body.params.ctx.prNumber === "7" && pushed[0].body.params.ctx.actorLogin === "octocat", "queued ctx carries the git identity");
ok(forgeApi.__calls.length === 0, "a git delivery costs the trigger zero Jira REST calls");
pushed.length = 0;
await listenerTrigger(gitEvent({ repoId: "someone/else" }), {});
ok(pushed.length === 0, "a delivery from a repo outside the allow-list is dropped before any full read");
pushed.length = 0;
await listenerTrigger(gitEvent({ actor: { login: "CogniRunner[bot]" } }), {});
ok(pushed.length === 0, "ignoreSelf: our own bot's delivery never re-enters the queue");
pushed.length = 0;
await listenerTrigger(gitEvent({ actor: { login: "CogniRunner[bot]" } }), {});
ok(pushed.length === 0, "…and stays dropped on redelivery");
const selfOff = await saveListener({ ...(await getListener(gitL.id)), ignoreSelf: false }, { accountId: "u" });
pushed.length = 0;
await listenerTrigger(gitEvent({ actor: { login: "CogniRunner[bot]" } }), {});
ok(pushed.length === 1 && pushed[0].body.params.listenerId === selfOff.id, "ignoreSelf:false lets the bot's own delivery through (opt-out is real)");
ok(!(await storage.get("event_sample:git:pull_request:opened")), "no event sample is stored for a git delivery (redactSample only knows Jira payloads)");
setConnectionIdentityResolver(null);

// F-010: the 25-candidate cap must SAY when it bites — it drops the TAIL of an
// append-ordered index, i.e. the listener someone just saved. Seed 26 slim rows with no
// `listener:{id}` records (getListener returns null and the loop skips them; the warning is
// emitted before that) and save a 27th, which is also what drops the trigger's index cache.
storage.__reset(); pushed.length = 0;
storage.__seed(LISTENER_INDEX_KEY, Array.from({ length: 26 }, (_, i) => ({ id: `lst_bulk${i}`, name: `bulk ${i}`, enabled: true, events: [RT_EVENT], projectKeys: [] })));
await saveListener({ name: "the newest one", events: [RT_EVENT], functions: [{ code: "api.log(3)" }] }, { accountId: "u" });
const warns = []; const realWarn = console.warn;
console.warn = (...a) => { warns.push(a.map(String).join(" ")); };
await listenerTrigger(rtEvent(), {});
console.warn = realWarn;
ok(warns.some((w) => w.includes(RT_EVENT) && w.includes("27 listeners matched") && w.includes("2 skipped")), "the 25-candidate truncation logs the event, the matched count and the dropped count");

// ── scheduled jobs ────────────────────────────────────────────────────────────
throws(() => normalizeJob({ name: "j" }), /schedule.cron is invalid/, "job needs a cron");
throws(() => normalizeJob({ name: "j", schedule: { cron: "0 9 * * *" } }), /functions must contain/, "job needs a step");
const j1 = normalizeJob({ name: "Nightly", schedule: { cron: "0 2 * * *", timeZone: "Europe/Zurich" }, scope: { jql: "project = LZPT", maxIssues: 500 }, functions: [{ code: "api.log(1)" }] });
ok(j1.id.startsWith("job_") && j1.scope.maxIssues === 100 && j1.schedule.timeZone === "Europe/Zurich" && j1.stats === undefined, "job normalised, scope clamped, no stats inside the record");
ok(normalizeJob({ name: "x", schedule: { cron: "* * * * *", timeZone: "Mars/Olympus" }, functions: [{ code: "1" }] }).schedule.timeZone === "UTC", "unknown zone → UTC");
ok(normalizeJob({ name: "x", schedule: { cron: "* * * * *" }, scope: { jql: "   " }, functions: [{ code: "1" }] }).scope === null, "blank scope → null");

// planTick: window since lastCheckedAt, one run per tick, missed count, disabled skipped, replay cap
const now = Date.UTC(2026, 2, 9, 9, 7, 30);
const rows = [
  { id: "a", enabled: true, schedule: { cron: "*/5 * * * *", timeZone: "UTC" } },
  { id: "b", enabled: true, schedule: { cron: "* * * * *", timeZone: "UTC" } },
  { id: "c", enabled: false, schedule: { cron: "* * * * *", timeZone: "UTC" } },
  { id: "d", enabled: true, schedule: { cron: "0 9 * * *", timeZone: "UTC" } },
  { id: "e", enabled: true, schedule: { cron: "* * * * *", timeZone: "UTC" } },
  { id: "f", enabled: true, schedule: { cron: "0 9 * * *", timeZone: "UTC" } },
];
const sched = {
  a: { lastCheckedAt: new Date(Date.UTC(2026, 2, 9, 9, 2, 20)).toISOString() },
  b: { lastCheckedAt: new Date(Date.UTC(2026, 2, 9, 9, 2, 20)).toISOString() },
  d: { lastCheckedAt: new Date(Date.UTC(2026, 2, 9, 9, 2, 20)).toISOString() },
  e: { lastCheckedAt: new Date(Date.UTC(2026, 2, 8, 9, 0)).toISOString() },
};
const due = planTick(rows, sched, now);
const byId = Object.fromEntries(due.map((d) => [d.job.id, d]));
ok(byId.a && byId.a.fireAt === Date.UTC(2026, 2, 9, 9, 5) && byId.a.missed === 0, "a: 09:05 due once");
ok(byId.b && byId.b.fireAt === Date.UTC(2026, 2, 9, 9, 7) && byId.b.missed === 4, "b: every-minute collapses to one run + 4 missed");
ok(!byId.c, "c: disabled skipped");
ok(!byId.d, "d: 09:00 was before the window");
ok(byId.e && byId.e.missed <= 60, "e: a day-old lastCheckedAt replays at most one hour");
ok(!byId.f, "f: never checked → 6-minute lookback does NOT reach back to 09:00 from 09:07:30");
const fresh = planTick([{ id: "g", enabled: true, schedule: { cron: "0 9 * * *", timeZone: "UTC" } }], {}, Date.UTC(2026, 2, 9, 9, 4));
ok(fresh.length === 1 && fresh[0].fireAt === Date.UTC(2026, 2, 9, 9, 0), "g: a brand-new job created just before 09:00 fires on the first tick after it");
ok(rows.every((r) => sched[r.id] && sched[r.id].lastCheckedAt === new Date(now).toISOString()), "every job's bookkeeping advanced (including disabled)");
ok(rows.every((r) => r.lastCheckedAt === undefined), "index rows are never mutated by the planner");

// storage + enable bookkeeping
storage.__reset();
const js = await saveJob({ name: "J", schedule: { cron: "0 9 * * *" }, functions: [{ code: "1" }] });
ok((await listJobs())[0].id === js.id && (await listJobs())[0].functions === undefined && typeof (await listJobs())[0].stats.nextRunAt === "string", "job index slim; nextRunAt computed on read");
ok((await storage.get("job_sched"))[js.id] && (await storage.get("job_sched"))[js.id].lastCheckedAt, "new job starts its window at save time (no pre-existence replay)");
const dis = await setJobEnabled(js.id, false);
ok(dis.enabled === false && dis.stats.nextRunAt === null, "disabled job has no next run");
const en = await setJobEnabled(js.id, true);
ok(en.enabled === true && typeof en.stats.nextRunAt === "string" && (await storage.get("job_sched"))[js.id].lastCheckedAt, "re-enabled job resets its window and next run");
const pv = previewSchedule({ cron: "0 9 * * 1-5", timeZone: "Europe/Zurich", count: 3 });
ok(pv.ok && pv.runs.length === 3 && pv.description === "Weekdays at 09:00", "preview");
ok(!previewSchedule({ cron: "bad" }).ok, "preview invalid");

// ── git events: repos filter, matching, ignoreSelf ───────────────────────────
const gitSeed = (over = {}) => ({ name: "PR review", events: ["git:pull_request:opened"], mode: "agent", agent: { instructions: "review it", allowedActions: [] }, ...over });
throws(() => normalizeListener(gitSeed()), /filters\.repos is required for git events/, "a git listener without a repos allow-list is refused");
const gl = normalizeListener(gitSeed({ filters: { repos: [" LeanZero/CogniRunner ", "leanzero/cognirunner", "Other/Repo"] } }));
ok(JSON.stringify(gl.filters.repos) === JSON.stringify(["leanzero/cognirunner", "other/repo"]), "repo ids trimmed, lower-cased, deduped");
ok(JSON.stringify(toIndexRow(gl).repos) === JSON.stringify(gl.filters.repos), "the slim index row carries repos so the trigger can pre-filter");
ok(normalizeListener({ name: "n", events: ["avi:jira:created:issue"], functions: [{ code: "1" }] }).filters.repos.length === 0, "a Jira listener needs no repos and gets an empty list");

const gctx = (over = {}) => ({ eventType: "git:pull_request:opened", repoId: "leanzero/cognirunner", connectionId: "gc_1", actorLogin: "octocat", issueKey: null, ...over });
ok(matchListenerStatic(gl, gctx(), {}).ok, "git listener matches its own repo");
ok(!matchListenerStatic(gl, gctx({ repoId: "someone/else" }), {}).ok, "a delivery from another repo does not match");
ok(matchListenerStatic(gl, gctx({ repoId: "LeanZero/CogniRunner" }), {}).ok, "repo matching is case-insensitive");
ok(!matchListenerStatic({ ...gl, filters: { ...gl.filters, repos: [] } }, gctx(), {}).ok, "a legacy git row with NO repos matches nothing (never everything)");
ok(!matchesListenerRepos([], gctx()) && !matchesListenerRepos(["a/b"], gctx({ repoId: null })), "empty allow-list / unknown repo never match");
// Project filters must not apply to a git event: the repo IS the scope.
ok(matchListenerStatic({ ...gl, filters: { ...gl.filters, projectKeys: ["LZPT"] } }, gctx({ projectKey: null }), {}).ok, "a project filter does not block a git event");

ok(sameGitActor("Octocat", "octocat") && !sameGitActor("a", "b") && !sameGitActor("", "") && !sameGitActor(null, "x"), "git actor comparison is case-insensitive and never matches an empty login");
setConnectionIdentityResolver(async (id) => (id === "gc_1" ? { login: "CogniRunner[bot]" } : null));
ok(await isGitSelfEvent(gctx({ actorLogin: "cognirunner[bot]" })), "ignoreSelf: our own bot's delivery is self");
ok(!(await isGitSelfEvent(gctx({ actorLogin: "octocat" }))), "ignoreSelf: a human's delivery is not self");
ok(!(await isGitSelfEvent(gctx({ connectionId: "gc_missing", actorLogin: "cognirunner[bot]" }))), "unknown connection: no identity, not self");
ok(!(await isGitSelfEvent({ eventType: "avi:jira:created:issue", actorLogin: "x", connectionId: "gc_1" })), "the git self-check never fires for a Jira event (selfGenerated is that one's flag)");
setConnectionIdentityResolver(async () => { throw new Error("kvs down"); });
ok(!(await isGitSelfEvent(gctx({ actorLogin: "cognirunner[bot]" }))), "identity lookup failure FAILS OPEN — the delivery runs, the brakes still cap a loop");
setConnectionIdentityResolver(null);


// ── 1.4 commit 5c: the git-event consumer ────────────────────────────────────
// savedByRole, the advisory cognirunner.git property, agentless dispatch.

// savedByRole: least privilege by DEFAULT — a caller that passes no role gets "editor",
// and only an admin save can arm a PR verdict action.
ok(normalizeSavedByRole(undefined) === "editor" && normalizeSavedByRole("nonsense") === "editor" && normalizeSavedByRole("admin") === "admin",
  "savedByRole normalises to editor unless the saver is an admin");
const base5c = { name: "PR", events: ["git:pull_request:opened"], mode: "agent", agent: { instructions: "go", allowedActions: [] }, filters: { repos: ["o/r"] } };
ok(normalizeListener(base5c).savedByRole === "editor", "a save with no role is recorded as editor (the REST API's case)");
ok(normalizeListener(base5c, { savedByRole: "admin" }).savedByRole === "admin", "an admin save is recorded as admin");
ok(normalizeListener({ ...base5c, gitReview: { allowVerdictActions: true } }).gitReview.allowVerdictActions === false,
  "an EDITOR cannot arm allowVerdictActions — stored false, never honoured");
ok(normalizeListener({ ...base5c, gitReview: { allowVerdictActions: true } }, { savedByRole: "admin" }).gitReview.allowVerdictActions === true,
  "an ADMIN can arm allowVerdictActions");
ok(normalizeListener({ ...base5c, gitReview: { allowVerdictActions: true }, savedByRole: "admin" }).gitReview.allowVerdictActions === false,
  "savedByRole in the BODY is ignored — the role comes from the resolver, never from the payload");
ok(normalizeListener({ ...base5c, agentlessTaskType: "rm -rf" }).agentlessTaskType === null
  && normalizeListener({ ...base5c, agentlessTaskType: "gitreview" }).agentlessTaskType === "gitreview",
  "agentlessTaskType accepts only the one engine id that exists");
ok(normalizeJob({ name: "j", schedule: { cron: "0 9 * * *" }, functions: [{ code: "1" }] }).savedByRole === "editor"
  && normalizeJob({ name: "j", schedule: { cron: "0 9 * * *" }, functions: [{ code: "1" }] }, { savedByRole: "admin" }).savedByRole === "admin",
  "a scheduled job records the saver's role the same way, from the same normaliser");

// The advisory property: merge per repo, bounded.
const pEntry = gitPropertyEntry({ pullRequest: { number: 7, state: "open", headSha: "abc" } }, { repoId: "o/r", eventType: "git:pull_request:opened" });
ok(pEntry.repoId === "o/r" && pEntry.pr.number === 7 && pEntry.pr.headSha === "abc", "the entry carries the PR identity");
ok(gitPropertyEntry({}, { repoId: "o/r", eventType: "git:push" }) === null, "a delivery with no PR and no build writes nothing");
ok(gitPropertyEntry({ pullRequest: { number: 7 } }, { repoId: null, eventType: "git:pull_request:opened" }) === null, "no repo, no property");
ok(gitPropertyEntry({ pullRequest: { number: 7 }, review: { state: "APPROVED" } }, { repoId: "o/r", eventType: "git:pull_request_review:submitted" }).pr.approved === true,
  "an approved review sets pr.approved");
ok(gitPropertyEntry({ check: { conclusion: "failure", headSha: "zz" } }, { repoId: "o/r", eventType: "git:check_run:completed" }).pr.build === "failure",
  "a completed check sets pr.build");
ok(gitPropertyEntry({ pullRequest: { number: 7 } }, { repoId: "o/r", eventType: "git:pull_request:merged" }).pr.merged === true,
  "the merged event is merged even when the payload omits the flag");
const merged1 = mergeGitProperty(null, pEntry, "2026-01-01T00:00:00.000Z");
ok(merged1.version === 1 && merged1.repos["o/r"].pr.number === 7, "a first write creates the repo entry");
const merged2 = mergeGitProperty(merged1, { repoId: "o/r", pr: { build: "success" } }, "2026-01-02T00:00:00.000Z");
ok(merged2.repos["o/r"].pr.number === 7 && merged2.repos["o/r"].pr.build === "success" && Object.keys(merged2.repos).length === 1,
  "a second write MERGES into the same repo: the build lands without losing the PR");
let manyRepos = null;
for (let i = 0; i < GIT_PROPERTY_MAX_REPOS + 3; i++) manyRepos = mergeGitProperty(manyRepos, { repoId: `o/r${i}`, pr: { number: i } }, `2026-01-0${i + 1}T00:00:00.000Z`);
ok(Object.keys(manyRepos.repos).length === GIT_PROPERTY_MAX_REPOS && manyRepos.repos["o/r7"] && !manyRepos.repos["o/r0"],
  `the property keeps the newest ${GIT_PROPERTY_MAX_REPOS} repositories and drops the oldest`);
ok(Buffer.byteLength(JSON.stringify(manyRepos), "utf8") <= GIT_PROPERTY_MAX_BYTES, "the property stays inside its byte bound");
ok(mergeGitProperty({ repos: "not an object" }, pEntry).repos["o/r"], "a corrupt previous value is replaced, never thrown on");
const hostile = mergeGitProperty(null, { repoId: "o/r", pr: { number: 1, state: "x".repeat(500), headSha: "y".repeat(500), extra: "dropped" } });
ok(hostile.repos["o/r"].pr.state.length === 24 && hostile.repos["o/r"].pr.headSha.length === 64 && hostile.repos["o/r"].pr.extra === undefined,
  "every field is clamped and unknown keys never reach the property");

// The property WRITE: reads the previous value, PUTs the merge, best-effort on failure.
storage.__reset(); forgeApi.__reset();
forgeApi.__respond((path, opts) => {
  if (path.includes(`/properties/${GIT_PROPERTY_KEY}`) && (!opts.method || opts.method === "GET")) return forgeApi.__response(200, { key: GIT_PROPERTY_KEY, value: { version: 1, repos: { "other/repo": { repoId: "other/repo", pr: { number: 1 }, updatedAt: "2025-01-01T00:00:00.000Z" } } } });
  return forgeApi.__response(200, {});
});
const wrote = await writeGitIssueProperty(
  { eventType: "git:pull_request:opened", pullRequest: { number: 7, headSha: "abc" } },
  { eventType: "git:pull_request:opened", repoId: "o/r", issueKeys: ["LZPT-1", "LZPT-2", "not a key"], issueKey: "LZPT-1" },
  ["LZPT-1", "LZPT-2", "not a key"],
);
const puts = forgeApi.__calls.filter((c) => c.opts && c.opts.method === "PUT");
ok(wrote.written === 2 && puts.length === 2, "the property is written on every valid issue key the delivery names, and only those");
const put0 = JSON.parse(puts[0].opts.body);
ok(put0.repos["o/r"].pr.number === 7 && put0.repos["other/repo"], "the write MERGES with what was already on the issue — another repo's state survives");
forgeApi.__reset();
forgeApi.__respond(() => { throw new Error("Jira down"); });
ok((await writeGitIssueProperty({ pullRequest: { number: 7 } }, { repoId: "o/r", issueKeys: ["LZPT-1"] }, ["LZPT-1"])).written === 0,
  "a failing property write is best-effort: it returns 0 and never throws into the dispatch");
storage.__reset(); forgeApi.__reset();
forgeApi.__respond((path, opts) => forgeApi.__response(opts && opts.method === "PUT" ? 200 : 404, {}));
ok((await writeGitIssueProperty({ pullRequest: { number: 7 } }, { repoId: "o/r", issueKeys: ["LZPT-1"] })).written === 0,
  "F-332 — the writer never re-derives keys from the envelope: with no authorised keys it writes nothing");

// F-332 — gitPropertyTargets is the ONE authorisation rule for the advisory property.
const f332ctx = { eventType: "git:pull_request:opened", repoId: "o/r", issueKeys: ["LZPT-1", "HR-42"] };
const rowOf = (over = {}) => ({ id: "l1", enabled: true, simulationMode: false, events: ["git:pull_request:opened"], repos: ["o/r"], projectKeys: [], ...over });
ok(JSON.stringify(gitPropertyTargets(f332ctx, [rowOf()])) === JSON.stringify(["LZPT-1", "HR-42"]),
  "a matching listener with no project filter allows every key the delivery names");
ok(JSON.stringify(gitPropertyTargets(f332ctx, [rowOf({ projectKeys: ["LZPT"] })])) === JSON.stringify(["LZPT-1"]),
  "BLOCK: a key in an unrelated project is NOT written when the matching listener is project-scoped (a branch named HR-42-x)");
ok(gitPropertyTargets(f332ctx, []).length === 0, "BLOCK: no listener at all ⇒ nothing is written");
ok(gitPropertyTargets(f332ctx, [rowOf({ repos: ["other/repo"] })]).length === 0, "BLOCK: a listener whose repos allow-list excludes this repo authorises nothing");
ok(gitPropertyTargets(f332ctx, [rowOf({ enabled: false })]).length === 0, "BLOCK: a disabled listener authorises nothing");
ok(gitPropertyTargets(f332ctx, [rowOf({ simulationMode: true })]).length === 0, "BLOCK: simulation mode writes nothing, and the property is a write");
ok(gitPropertyTargets(f332ctx, [rowOf({ events: ["git:push"] })]).length === 0, "BLOCK: a listener subscribed to another event authorises nothing");
ok(gitPropertyTargets({ ...f332ctx, issueKeys: Array.from({ length: 9 }, (_, i) => `LZPT-${i + 1}`) }, [rowOf()]).length === 5,
  "ALLOW: the ≤5 clamp survives the new rule");

// dispatchGitEvent: the consumer entry. Matches, writes the property, enqueues — no AI.
storage.__reset(); forgeApi.__reset(); pushed.length = 0;
// 404 on the GET (no property yet), 200 on the PUT — the ordinary first write.
const propOk = (path, opts) => forgeApi.__response(opts && opts.method === "PUT" ? 200 : 404, {});
forgeApi.__respond(propOk);
setConnectionIdentityResolver(async () => ({ login: "cognirunner[bot]" }));
const agentL = await saveListener({ name: "PR agent", events: ["git:pull_request:opened"], mode: "agent", agent: { instructions: "review", allowedActions: [] }, filters: { repos: ["leanzero/cognirunner"] } }, { accountId: "u", savedByRole: "admin" });
const env5c = { eventType: "git:pull_request:opened", source: "git", connectionId: "gc_1", repoId: "LeanZero/CogniRunner", deliveryId: "d-1", actor: { login: "octocat" }, pullRequest: { number: 7, title: "t", headSha: "abc" }, issueKeys: ["LZPT-4"] };
const d1 = await dispatchGitEvent(env5c);
ok(pushed.length === 1 && pushed[0].body.taskType === "listener" && pushed[0].body.params.listenerId === agentL.id,
  "an AGENT listener is dispatched as the normal listener task, with the envelope as the event");
ok(pushed[0].body.params.event.pullRequest.number === 7 && pushed[0].body.params.ctx.repoId === "leanzero/cognirunner",
  "the envelope reaches the consumer intact");
ok(d1.queued === 1 && d1.propertyWrites === 1, "the dispatch reports what it did");
ok(forgeApi.__calls.some((c) => c.path.includes(`/properties/${GIT_PROPERTY_KEY}`) && c.opts.method === "PUT"), "the advisory property is written for the delivery's issue key");
ok((await dispatchGitEvent({ eventType: "avi:jira:created:issue" })).skipped === "not-a-git-event", "a Jira event id is refused by the git entry point");
// F-332 end to end: a key in a project the matching listener is not scoped to is never PUT.
forgeApi.__reset(); forgeApi.__respond(propOk); pushed.length = 0;
await setListenerEnabled(agentL.id, false); // only the project-scoped listener may authorise here
const scopedL = await saveListener({ name: "PR agent scoped", events: ["git:pull_request:opened"], mode: "agent", agent: { instructions: "review", allowedActions: [] }, filters: { repos: ["leanzero/cognirunner"], projectKeys: ["LZPT"] } }, { accountId: "u", savedByRole: "admin" });
const dScoped = await dispatchGitEvent({ ...env5c, deliveryId: "d-2", issueKeys: ["LZPT-4", "HR-42"] });
ok(dScoped.propertyWrites === 1, "ALLOW: the in-scope key is written once");
ok(!forgeApi.__calls.some((c) => c.path.includes("HR-42")), "BLOCK: the unrelated project's key is never touched");
await deleteListener(scopedL.id);
await setListenerEnabled(agentL.id, true);

// agentless: the premade PR-review engine, queued as gitreview with the review params.
pushed.length = 0; forgeApi.__reset(); forgeApi.__respond(propOk);
await deleteListener(agentL.id);
const agentlessL = await saveListener({
  name: "PR engine", events: ["git:pull_request:opened"], mode: "script", functions: [{ code: "api.log(1)" }],
  agentlessTaskType: "gitreview", filters: { repos: ["leanzero/cognirunner"] }, simulationMode: true,
}, { accountId: "u", savedByRole: "admin" });
await dispatchGitEvent(env5c);
// deleteListener above also pushes a rule_stats housekeeping event — look at the run tasks.
const runTasks = pushed.filter((x) => x.body && (x.body.taskType === "gitreview" || x.body.taskType === "listener"));
ok(runTasks.length === 1 && runTasks[0].body.taskType === "gitreview", "an agentless git listener enqueues the deterministic review engine, not a listener run");
const gp = runTasks[0].body.params;
ok(gp.connId === "gc_1" && gp.repoId === "leanzero/cognirunner" && gp.prNumber === "7" && gp.ruleId === agentlessL.id && gp.simulation === true,
  "the gitreview params carry exactly { connId, repoId, prNumber, ruleId, simulation }");
ok(gp.savedByRole === undefined && gp.allowVerdictActions === undefined,
  "the verdict permission is NOT in the params — the engine reads it from the rule row, so a forged param cannot arm it");
// The brakes are the listener brakes, unchanged: a braked git listener is not dispatched.
pushed.length = 0;
const bucket = Math.floor(Date.now() / 300000);
storage.__seed(`lst_brake:L:${agentlessL.id}:${bucket}`, BRAKE_MAX_PER_LISTENER);
await dispatchGitEvent(env5c);
ok(pushed.filter((x) => x.body && x.body.taskType === "gitreview").length === 0, "the per-listener brake (120 / 5 min) stops a git delivery exactly as it stops a Jira event");
setConnectionIdentityResolver(null);

// ── breaker 35: git brakes, identity, payload trimming, the agentless premade ──

// F-320 — a git delivery has no issue key, so the per-OBJECT brake keys on the PR.
ok(brakeObjectKey({ eventType: "avi:jira:updated:issue", issueKey: "LZPT-1" }) === "LZPT-1", "a Jira event still brakes per issue");
ok(brakeObjectKey({ eventType: "git:pull_request:opened", repoId: "o/r", prNumber: 7 }) === "git:o/r#7", "a git delivery brakes per PULL REQUEST");
ok(brakeObjectKey({ eventType: "git:push", repoId: "o/r" }) === "git:o/r", "a push with no PR brakes per repository");
ok(brakeObjectKey({ eventType: "git:pull_request:opened", repoId: "o/r", prNumber: 7, issueKey: "LZPT-9" }) === "LZPT-9",
  "a git delivery that DID resolve a Jira key brakes on the issue (the tighter object)");
ok(brakeObjectKey({ eventType: "git:pull_request:opened" }) === null, "no repo and no issue: no per-object brake to take");

// …and it really bites: seed the PR's bucket at the cap and the delivery is stopped.
storage.__reset(); forgeApi.__reset(); pushed.length = 0;
forgeApi.__respond((path, opts) => forgeApi.__response(opts && opts.method === "PUT" ? 200 : 404, {}));
setConnectionIdentityResolver(async () => ({ login: "cognirunner[bot]" }));
const brakeL = await saveListener({ name: "PR agent", events: ["git:pull_request:opened"], mode: "agent", agent: { instructions: "x", allowedActions: [] }, filters: { repos: ["o/r"] } }, { accountId: "u" });
const genv = { eventType: "git:pull_request:opened", source: "git", connectionId: "gc_1", repoId: "o/r", actor: { login: "octocat" }, pullRequest: { number: 7, headSha: "a" } };
storage.__seed(`lst_brake:git:o-r#7:${Math.floor(Date.now() / 300000)}`, BRAKE_MAX_PER_ISSUE);
await dispatchGitEvent(genv);
ok(pushed.filter((x) => x.body && x.body.taskType === "listener").length === 0,
  "the 30-per-5-min loop guard now exists for a PR with no Jira key (F-320)");
pushed.length = 0;
await dispatchGitEvent({ ...genv, pullRequest: { number: 8, headSha: "b" } });
ok(pushed.filter((x) => x.body && x.body.taskType === "listener").length === 1, "…and it is PER PULL REQUEST, not per repository");
ok(brakeL.id, "the braked listener is the same rule");

// F-326 — identity, not a label: an id match wins, an id MISMATCH refuses a login match.
ok(sameGitActor({ accountId: "557058:x" }, { accountId: "557058:X" }), "an account id matches case-insensitively");
ok(sameGitActor({ login: "Mihai P", uuid: "{u1}" }, { login: "mihaip", uuid: "{U1}" }),
  "a Bitbucket actor whose nickname differs from whoami's username is STILL self, on the uuid (F-326)");
ok(!sameGitActor({ login: "bot", uuid: "{u1}" }, { login: "bot", uuid: "{u2}" }), "two different accounts that share a display name are NOT the same actor");
ok(sameGitActor("Octocat", "octocat") && !sameGitActor("a", "b"), "a bare login on either side still works (every existing caller)");
ok(!sameGitActor({}, {}) && !sameGitActor(null, { login: "x" }), "nothing matches nothing");

// F-328 — the self-check is resolved ONCE per delivery, not once per candidate.
storage.__reset(); forgeApi.__reset(); pushed.length = 0;
forgeApi.__respond((path, opts) => forgeApi.__response(opts && opts.method === "PUT" ? 200 : 404, {}));
let identityReads = 0;
setConnectionIdentityResolver(async () => { identityReads++; return { login: "cognirunner[bot]" }; });
for (let i = 0; i < 4; i++) await saveListener({ name: `PR ${i}`, events: ["git:pull_request:opened"], mode: "agent", agent: { instructions: "x", allowedActions: [] }, filters: { repos: ["o/r"] } }, { accountId: "u" });
await dispatchGitEvent(genv);
ok(identityReads === 1, `the connection identity is read ONCE per delivery, not once per candidate (read ${identityReads}x for 4 listeners)`);
setConnectionIdentityResolver(null);

// ── F-333: the git branch of the AI summary ───────────────────────────────────
const f333env = {
  eventType: "git:pull_request:opened", source: "git", repoId: "o/r", actor: { login: "octocat" },
  pullRequest: { number: 12, title: "H".repeat(400) + " <<<CONTEXT", state: "open", merged: false, draft: true, headRef: "HR-42-hotfix", baseRef: "main", author: { login: "octocat" } },
  review: { state: "approved", body: "ship it", author: { login: "rev" } },
  check: { name: "build", conclusion: "success" },
  push: { ref: "refs/heads/x", commits: Array.from({ length: 14 }, (_, i) => ({ message: `commit ${i}` })) },
  comment: { body: "please merge", author: { login: "c" } },
  issueKeys: ["LZPT-4"],
};
const f333 = summarizeEventForAi("git:pull_request:opened", f333env, { eventType: "git:pull_request:opened", entityName: "o/r PR #12", issueKey: "LZPT-4" });
ok(/Pull request #12: H{200}$/m.test(f333), "the PR title reaches the prompt, clamped to 200 chars");
ok(!/<<<|>>>/.test(f333), "F-333: no fence token survives — the whole git branch goes through defangFence");
ok(/PR state: open, draft/.test(f333) && /PR refs: HR-42-hotfix → main/.test(f333), "state, draft and both refs are in the summary");
ok(/Review by rev: approved/.test(f333) && /ship it/.test(f333), "the review state and body reach the prompt");
ok(/Check "build": success/.test(f333), "the check name and conclusion reach the prompt");
ok(/Push to refs\/heads\/x/.test(f333) && (f333.match(/^ {2}- commit /gm) || []).length === 10 && /4 more commit\(s\)/.test(f333),
  "the push ref and at most 10 commit subjects reach the prompt, with the remainder counted");
ok(/Comment by c: please merge/.test(f333), "the comment body reaches the prompt");
ok(/ADVISORY/.test(f333), "the issue keys are labelled advisory in the prompt itself");
ok(!/Pull request/.test(summarizeEventForAi("avi:jira:created:issue", { issue: { fields: { summary: "s" } } }, { eventType: "avi:jira:created:issue" })),
  "a Jira event summary is unchanged");

// ── agent actions ────────────────────────────────────────────────────────────
ok(JSON.stringify(normalizeAllowedActions(["finish", "get_issue", "get_issue", "zzz"])) === JSON.stringify(["get_issue"]), "finish is implicit, dupes/unknown dropped");
const defs = toolDefinitionsFor(["add_comment"]);
ok(defs.length === 2 && defs.map((d) => d.function.name).sort().join() === "add_comment,finish", "tool defs = allowed + finish");
ok(defs.every((d) => d.type === "function" && d.function.parameters.type === "object"), "OpenAI tool shape");

console.log(`LISTENERS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
