/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-620 / F-622 — THE EXISTENCE-LEAK PARITY, ASSERTED AT EVERY DOOR AT ONCE.
 *
 * F-261's rule: for a caller whose scope is not "all", "that id does not exist" and
 * "that id is someone else's row" must be THE SAME ANSWER, byte for byte. Ids are not
 * secrets on their own, but the SET of them maps a colleague's automation, and every
 * write door takes an id from the caller.
 *
 * F-616 closed a create-at-a-client-chosen-id hole by adding a not-found refusal at
 * three doors — and two of them re-opened F-261 while doing it:
 *  · F-620, `src/rules-api.js` POST create/upsert pre-flight: `if (!row) return 404`
 *    sat ABOVE `ownerGate`, so a scope-"own" REST token read 404 = free id,
 *    403 not-owner = a colleague's row. The widest door onto the map (100 ids per
 *    request, refused before any write, so probing cost nothing).
 *  · F-622, `saveSkill` in `src/index.js`: an unknown id answered a bare
 *    "Skill not found" instead of going through `gateSaveById`.
 *
 * WHY THIS SUITE EXISTS RATHER THAN TWO MORE ASSERTIONS IN THE F-616 SUITES: the same
 * rule now lives behind seven doors, and it has been re-broken once already by a fix to
 * a neighbouring rule. This walks EVERY door — resolvers listeners/jobs/agents/skills
 * and REST listeners/jobs/agents — and asserts the same three things at each:
 *   1. a scope-"own" caller's unknown-id and foreign-row refusals are byte-identical;
 *   2. an admin (scope "all") still gets the plain not-found — it is not a leak for a
 *      caller who may act on every row, and hiding it would break the UI's "it's gone";
 *   3. nothing is written by a refused call, including a refused REST BATCH (the
 *      commitImportCore lesson: the refusal lands BEFORE the side effect).
 *
 * Run: node scripts/existence-parity.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const same = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${what} — unknown-id and foreign-row refusals are byte-identical (unknown=${JSON.stringify(a)} foreign=${JSON.stringify(b)})`);

const ADMIN = "acct-admin";
const OWN = "acct-own-editor";

await storage.set("app_admins", [
  { accountId: ADMIN, role: "admin", scope: "all" },
  { accountId: OWN, role: "editor", scope: "own" },
]);
await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { handler } = await import("../../src/index.js");
const { createApiTokenInternal, rulesApiHandler } = await import("../../src/rules-api.js");
const { JOB_INDEX_KEY } = await import("../../src/scheduled-jobs.js");
const { LISTENER_INDEX_KEY } = await import("../../src/listeners.js");

const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

const jobIndex = async () => (await storage.get(JOB_INDEX_KEY)) || [];
const listenerIndex = async () => (await storage.get(LISTENER_INDEX_KEY)) || [];
const skillIndex = async () => (await storage.get("skill_repo_index")) || [];

const jobBody = (over = {}) => ({
  name: "parity job", schedule: { cron: "0 9 * * *", timeZone: "UTC" },
  scope: { jql: "project = LZPT" }, functions: [{ code: "api.log(1)" }], ...over,
});
const listenerBody = (over = {}) => ({
  name: "parity listener", events: ["avi:jira:created:issue"],
  functions: [{ code: "api.log(1)" }], ...over,
});

/* ═════ resolver doors ═════ */

/* jobs — the door F-616 was found on */
{
  const mine = await call("saveScheduledJob", { job: jobBody({ name: "admin's job" }) }, ADMIN);
  const foreign = mine.job.id;
  const FREE = "job_parity_free";
  const a = await call("saveScheduledJob", { job: jobBody({ id: FREE }) }, OWN);
  const b = await call("saveScheduledJob", { job: jobBody({ id: foreign }) }, OWN);
  ok(a.success === false && b.success === false, "resolver jobs: a scope-'own' editor is refused on both ids");
  same(a, b, "resolver saveScheduledJob");
  ok(a.error !== "Scheduled job not found", "resolver jobs: the not-found sentence is not shown to a scope-'own' caller");
  const adminAnswer = await call("saveScheduledJob", { job: jobBody({ id: FREE }) }, ADMIN);
  ok(adminAnswer.success === false && adminAnswer.error === "Scheduled job not found",
    `resolver jobs: an ADMIN still gets the plain not-found (got ${adminAnswer.error})`);
  ok(!(await jobIndex()).find((x) => x.id === FREE), "resolver jobs: nothing was written at the refused id");
}

/* listeners */
{
  const mine = await call("saveListener", { listener: listenerBody({ name: "admin's listener" }) }, ADMIN);
  const foreign = mine.listener.id;
  const FREE = "lst_parity_free";
  const a = await call("saveListener", { listener: listenerBody({ id: FREE }) }, OWN);
  const b = await call("saveListener", { listener: listenerBody({ id: foreign }) }, OWN);
  ok(a.success === false && b.success === false, "resolver listeners: a scope-'own' editor is refused on both ids");
  same(a, b, "resolver saveListener");
  const adminAnswer = await call("saveListener", { listener: listenerBody({ id: FREE }) }, ADMIN);
  ok(adminAnswer.success === false && adminAnswer.error === "Listener not found",
    `resolver listeners: an ADMIN still gets the plain not-found (got ${adminAnswer.error})`);
  ok(!(await listenerIndex()).find((x) => x.id === FREE), "resolver listeners: nothing was written at the refused id");
}

/* skills — F-622's door */
{
  const mine = await call("saveSkill", { name: "Admin's skill", instructions: "do a thing" }, ADMIN);
  const foreign = mine.id;
  const FREE = "skill_parity_free";
  const a = await call("saveSkill", { id: FREE, name: "Planted", instructions: "x" }, OWN);
  const b = await call("saveSkill", { id: foreign, name: "Hijacked", instructions: "x" }, OWN);
  ok(a.success === false && b.success === false, "resolver skills: a scope-'own' editor is refused on both ids");
  same(a, b, "resolver saveSkill (F-622)");
  ok(a.error !== "Skill not found",
    `resolver skills: the not-found sentence is NOT the scope-'own' answer any more (got ${a.error})`);
  const adminAnswer = await call("saveSkill", { id: FREE, name: "Planted", instructions: "x" }, ADMIN);
  ok(adminAnswer.success === false && adminAnswer.error === "Skill not found",
    `resolver skills: an ADMIN still gets "Skill not found" (got ${adminAnswer.error})`);
  ok(!(await skillIndex()).find((s) => s.id === FREE), "resolver skills: no skill row was planted at the refused id");
  const stillMine = (await skillIndex()).find((s) => s.id === foreign);
  ok(stillMine && stillMine.name === "Admin's skill", "resolver skills: the colleague's skill was NOT overwritten");
}

/* agents — the VA resolvers sit at the ADMIN floor, so the parity here is that the
 * floor answers FIRST and an id never reaches a row read at all. */
{
  const a = await call("listVaDrafts", { jobId: "job_parity_free" }, OWN);
  const b = await call("listVaDrafts", { jobId: (await jobIndex())[0]?.id || "job_x" }, OWN);
  ok(a.success === false && b.success === false, "resolver agents: a scope-'own' editor is refused on both ids");
  same(a, b, "resolver listVaDrafts");
}

/* ═════ REST doors ═════ */

const tokens = {
  admin: (await createApiTokenInternal({ name: "parity admin", accountId: ADMIN, role: "admin" })).token,
  own: (await createApiTokenInternal({ name: "parity own", accountId: OWN, role: "editor" })).token,
};
const rest = async (as, resource, { method = "GET", query = {}, body } = {}) => {
  const res = await rulesApiHandler({
    method,
    headers: { authorization: `Bearer ${tokens[as]}` },
    queryParameters: Object.fromEntries(Object.entries({ resource, ...query }).map(([k, v]) => [k, [String(v)]])),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

/* REST jobs + listeners — F-620's door: the POST create/upsert pre-flight */
for (const [resource, mk, noun, free, indexOf] of [
  ["jobs", jobBody, "job", "job_rest_parity_free", jobIndex],
  ["listeners", listenerBody, "listener", "lst_rest_parity_free", listenerIndex],
]) {
  const mine = await rest("admin", resource, { method: "POST", body: mk({ name: `admin's rest ${noun}` }) });
  const foreign = mine.body[noun].id;
  const a = await rest("own", resource, { method: "POST", body: mk({ id: free }) });
  const b = await rest("own", resource, { method: "POST", body: mk({ id: foreign }) });
  ok(a.status === 403 && b.status === 403,
    `REST ${resource}: a scope-'own' token gets 403 for BOTH ids — never 404 for a free one (got ${a.status}/${b.status})`);
  same(a, b, `REST POST ?resource=${resource} (F-620)`);
  const adminAnswer = await rest("admin", resource, { method: "POST", body: mk({ id: free }) });
  ok(adminAnswer.status === 404, `REST ${resource}: an ADMIN token still gets the plain 404 (got ${adminAnswer.status})`);
  ok(!(await indexOf()).find((x) => x.id === free), `REST ${resource}: nothing was written at the refused id`);

  /* a refused BATCH writes NOTHING — the pre-flight runs whole before any save */
  const batchName = `batch parity ${noun}`;
  const batch = await rest("own", resource, { method: "POST", body: [mk({ name: batchName }), mk({ id: foreign })] });
  ok(batch.status === 403, `REST ${resource}: a batch carrying a foreign id is refused whole (got ${batch.status})`);
  ok(!(await indexOf()).find((x) => x.name === batchName),
    `REST ${resource}: …and the earlier item of that batch was NOT written`);
}

/* REST agents — the admin floor answers before any id is read, both ways */
{
  const a = await rest("own", "agents", { method: "POST", body: { id: "job_rest_parity_free", name: "planted" } });
  const b = await rest("own", "agents", { method: "POST", body: { id: (await jobIndex())[0]?.id || "job_x", name: "planted" } });
  ok(a.status === 403 && b.status === 403, `REST agents: a scope-'own' token is refused on both ids (got ${a.status}/${b.status})`);
  same(a, b, "REST POST ?resource=agents");
}

console.log(`existence-parity (F-620/F-622): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
