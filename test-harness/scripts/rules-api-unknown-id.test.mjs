/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-616, THE REST TWIN — A CREATE MUST NEVER ACCEPT A CLIENT-CHOSEN ID.
 *
 * `save-unknown-id.test.mjs` proves the resolvers. This one proves the other door onto
 * the same rows, because "one rule, one home" is only true if both doors answer the
 * same way: `POST ?resource=listeners|jobs` with a BODY id, and `POST ?resource=agents`
 * with a body/query id, used to fall through to `save()` when the id matched nothing —
 * `normalizeListener`/`normalizeJob` honour a caller-supplied `src.id`, so the row was
 * CREATED at the id the client picked. For an agent that means a live Virtual
 * Administrator planted on a deleted one's `va_*` ledger namespace and its standing
 * `va_purged:` tombstone.
 *
 * Asserted in BOTH directions, per door: an unknown id is 404 AND NOTHING IS WRITTEN;
 * a create with no id still returns 201; an upsert onto a REAL id still works.
 *
 * Run: node scripts/rules-api-unknown-id.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

forgeApi.__respond((route) => {
  const url = String(route || "");
  // The VA catalogue check `prepareVaSave` runs, answered so an agent create can succeed.
  if (url.includes("/servicedeskapi/servicedesk/") && url.includes("/queue")) {
    return forgeApi.__response(200, { values: [{ id: "1", name: "Waiting for support", jql: "resolution = Unresolved" }] });
  }
  if (url.includes("/servicedeskapi/servicedesk")) return forgeApi.__response(200, { values: [{ id: "1", projectName: "Support desk" }] });
  return forgeApi.__response(200, {});
});

storage.__seed("app_admins", [{ accountId: "admin-1", displayName: "Admin", role: "admin", scope: "all" }]);
await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });

const { createApiTokenInternal, rulesApiHandler } = await import("../../src/rules-api.js");
const { JOB_INDEX_KEY, JOB_PREFIX } = await import("../../src/scheduled-jobs.js");
const { LISTENER_INDEX_KEY } = await import("../../src/listeners.js");

const token = (await createApiTokenInternal({ name: "admin", accountId: "admin-1", role: "admin" })).token;
const rest = async (resource, { method = "GET", query = {}, body } = {}) => {
  const res = await rulesApiHandler({
    method,
    headers: { authorization: `Bearer ${token}` },
    queryParameters: Object.fromEntries(Object.entries({ resource, ...query }).map(([k, v]) => [k, [String(v)]])),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const listenerBody = (over = {}) => ({ name: "rest listener", events: ["avi:jira:created:issue"], functions: [{ code: "api.log(1)" }], ...over });
const jobBody = (over = {}) => ({ name: "rest job", schedule: { cron: "0 9 * * *", timeZone: "UTC" }, scope: { jql: "project = LZPT" }, functions: [{ code: "api.log(1)" }], ...over });
const jobIndex = async () => (await storage.get(JOB_INDEX_KEY)) || [];
const listenerIndex = async () => (await storage.get(LISTENER_INDEX_KEY)) || [];

/* ── jobs: POST with an unmatched body id ─────────────────────────────────── */
{
  const UNKNOWN = "job_rest_unknown_616";
  const r = await rest("jobs", { method: "POST", body: jobBody({ id: UNKNOWN }) });
  ok(r.status === 404, `POST ?resource=jobs with an unknown body id is 404 (got ${r.status} ${JSON.stringify(r.body).slice(0, 160)})`);
  ok(!(await jobIndex()).find((x) => x.id === UNKNOWN), "…and no job row was written at that id");
  ok(((await storage.get(JOB_PREFIX + UNKNOWN)) ?? null) === null, "…and no record key either");
}
{
  const created = await rest("jobs", { method: "POST", body: jobBody() });
  ok(created.status === 201 && created.body.job && created.body.job.id, `a create with NO id still returns 201 (got ${created.status})`);
  const id = created.body.job.id;
  const upsert = await rest("jobs", { method: "POST", body: jobBody({ id, name: "rest job II" }) });
  ok(upsert.status === 201 || upsert.status === 200, `an upsert onto a REAL id still succeeds (got ${upsert.status})`);
  ok(upsert.body.job && upsert.body.job.id === id && upsert.body.job.name === "rest job II", "…in place, under the same id");
  // …and once it is gone, the same body is refused: no resurrection through this door.
  ok((await rest("jobs", { method: "DELETE", query: { id } })).status === 200, "the job deletes");
  const again = await rest("jobs", { method: "POST", body: jobBody({ id }) });
  ok(again.status === 404, `a POST re-using the DELETED id is 404 (got ${again.status})`);
}
/* a MIXED batch is refused BEFORE anything is written — the commitImportCore lesson */
{
  const batch = await rest("jobs", { method: "POST", body: [jobBody({ name: "batch ok" }), jobBody({ id: "job_rest_unknown_616b" })] });
  ok(batch.status === 404, `a batch carrying one unknown id is refused whole (got ${batch.status})`);
  ok(!(await jobIndex()).find((x) => x.name === "batch ok"), "…and the earlier item of the batch was NOT written");
}

/* ── listeners: the same door ─────────────────────────────────────────────── */
{
  const UNKNOWN = "lst_rest_unknown_616";
  const r = await rest("listeners", { method: "POST", body: listenerBody({ id: UNKNOWN }) });
  ok(r.status === 404, `POST ?resource=listeners with an unknown body id is 404 (got ${r.status})`);
  ok(!(await listenerIndex()).find((x) => x.id === UNKNOWN), "…and no listener row was written");
  const created = await rest("listeners", { method: "POST", body: listenerBody() });
  ok(created.status === 201, `a listener create with NO id still returns 201 (got ${created.status})`);
  const upsert = await rest("listeners", { method: "POST", body: listenerBody({ id: created.body.listener.id, name: "rest listener II" }) });
  ok(upsert.body.listener && upsert.body.listener.name === "rest listener II", "…and an upsert onto a real id still saves in place");
}

/* ── agents: the route the live re-creation actually used ─────────────────── */
const vaRecord = () => ({
  persona: { name: "Ada", voice: { register: "terse", greeting: false, maxSentences: 3, language: "auto" }, signature: false },
  scope: { read: { site: false, projects: ["SUP"] }, write: { projects: ["SUP"] } },
  intake: { serviceDesks: [{ serviceDeskId: "1", queueIds: ["10"] }], jql: "", mentionsOf: [], owedFirst: true },
  cadence: { preset: "every30", timeZone: "UTC", postWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" } },
  powers: { replyPublic: false, replyInternal: true, assign: false, transition: false, editFields: false, confluenceRead: false, confluenceWrite: false, git: false, webSearch: false, skillIds: [] },
  guardrails: { capsPerHour: 6, capsPerDay: 20, owedPerHour: 12, shadowTicks: 3, minPostGapMinutes: 15, antiPileUpDays: 3, otherWriterQuietMinutes: 20, approvalProjectKey: "", maxItemsPerTick: 2, maxWritesPerRun: 10 },
  status: { paused: false, shadowUntilTick: 500 },
});
{
  const UNKNOWN = "job_agent_unknown_616";
  const byBody = await rest("agents", { method: "POST", body: { id: UNKNOWN, name: "planted", va: vaRecord() } });
  ok(byBody.status === 404, `POST ?resource=agents with an unknown BODY id is 404 (got ${byBody.status} ${JSON.stringify(byBody.body).slice(0, 160)})`);
  const byQuery = await rest("agents", { method: "POST", query: { id: UNKNOWN }, body: { name: "planted", va: vaRecord() } });
  ok(byQuery.status === 404, `…and with an unknown ?id= too (got ${byQuery.status})`);
  ok(!(await jobIndex()).find((x) => x.id === UNKNOWN), "…and no agent row was planted at that id");

  const created = await rest("agents", { method: "POST", body: { name: "real agent", va: vaRecord() } });
  ok(created.status === 201 && created.body.agent && created.body.agent.id,
    `an agent create with NO id still returns 201 (got ${created.status} ${JSON.stringify(created.body).slice(0, 200)})`);
  const id = created.body.agent && created.body.agent.id;
  if (id) {
    const upsert = await rest("agents", { method: "POST", query: { id }, body: { va: vaRecord() } });
    ok(upsert.status === 200, `an upsert onto a REAL agent id still succeeds (got ${upsert.status})`);
    ok((await rest("agents", { method: "DELETE", query: { id } })).status === 200, "the agent deletes");
    const again = await rest("agents", { method: "POST", query: { id }, body: { name: "resurrected", va: vaRecord() } });
    ok(again.status === 404, `and it cannot be re-created under the SAME id — the F-616 live path (got ${again.status})`);
  }
}

console.log(`rules-api-unknown-id (F-616): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
