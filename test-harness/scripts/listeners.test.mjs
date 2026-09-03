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
  BRAKE_MAX_PER_LISTENER,
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

// ── agent actions ────────────────────────────────────────────────────────────
ok(JSON.stringify(normalizeAllowedActions(["finish", "get_issue", "get_issue", "zzz"])) === JSON.stringify(["get_issue"]), "finish is implicit, dupes/unknown dropped");
const defs = toolDefinitionsFor(["add_comment"]);
ok(defs.length === 2 && defs.map((d) => d.function.name).sort().join() === "add_comment,finish", "tool defs = allowed + finish");
ok(defs.every((d) => d.type === "function" && d.function.parameters.type === "object"), "OpenAI tool shape");

console.log(`LISTENERS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
