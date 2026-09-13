/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-616 — A CREATE MUST NEVER ACCEPT A CLIENT-CHOSEN ID.
 *
 * `saveScheduledJob` / `saveListener` UPSERT on `input.id` and asked `gateExistingRow`,
 * but returned only the PERMISSION arm of its answer:
 *
 *     if (refusal && refusal.reason === PERMISSION_REFUSAL_REASON) return refusal;
 *
 * so the `notFound` sentence each call site supplied was dead copy, and a save carrying
 * an id that matched NO row fell through and WROTE THE ROW AT THAT ID. Proven live on
 * 2026-09-13 against a job deleted seconds earlier. An id is a namespace — a Virtual
 * Administrator's whole `va_*` ledger and its `va_purged:` tombstone hang off its job id
 * — so this is how a deleted agent came back on top of its own dead state.
 *
 * WHAT THIS SUITE PROVES, through the REAL resolvers in src/index.js:
 *  · an unknown id is REFUSED with the call site's not-found sentence, and NO ROW IS
 *    WRITTEN (the store is read afterwards — a refusal that still wrote is the defect);
 *  · the same for listeners and for skills (`saveSkill` honours `meta.id` the same way);
 *  · a create with NO id still works, and an edit of a REAL row still works — a gate
 *    asserted in one direction only can drift the other way without failing;
 *  · F-261 is intact: for a scope-"own" editor an unknown id and a foreign row are the
 *    SAME refusal, byte for byte, so ids stay unenumerable.
 *
 * Run: node scripts/save-unknown-id.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const OWN = "acct-own-editor";

await storage.set("app_admins", [
  { accountId: ADMIN, role: "admin", scope: "all" },
  { accountId: OWN, role: "editor", scope: "own" },
]);
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { handler } = await import("../../src/index.js");
const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

const jobBody = (over = {}) => ({
  name: "F-616 job", schedule: { cron: "0 9 * * *", timeZone: "UTC" },
  scope: { jql: "project = LZPT" }, functions: [{ code: "api.log(1)" }], ...over,
});
const listenerBody = (over = {}) => ({
  name: "F-616 listener", events: ["avi:jira:created:issue"],
  functions: [{ code: "api.log(1)" }], ...over,
});

// The key NAMES come from the modules that own them — never retyped here, or this
// suite goes quietly green the day one of them is renamed.
const { JOB_INDEX_KEY, JOB_PREFIX } = await import("../../src/scheduled-jobs.js");
const { LISTENER_INDEX_KEY } = await import("../../src/listeners.js");
const jobIndex = async () => (await storage.get(JOB_INDEX_KEY)) || [];
const listenerIndex = async () => (await storage.get(LISTENER_INDEX_KEY)) || [];

/* ═════ 1. SCHEDULED JOBS — the resolver the live proof came from ═════ */
{
  const UNKNOWN = "job_does_not_exist_616";
  const before = await jobIndex();
  const r = await call("saveScheduledJob", { job: jobBody({ id: UNKNOWN }) });
  ok(r && r.success === false, `an unknown job id is REFUSED (got ${JSON.stringify(r).slice(0, 200)})`);
  ok(r && r.error === "Scheduled job not found",
    `…with the call site's own sentence, which used to be dead copy (got ${r && r.error})`);
  const after = await jobIndex();
  ok(after.length === before.length && !after.find((x) => x.id === UNKNOWN),
    "…and NO index row was written for that id");
  ok(((await storage.get(JOB_PREFIX + UNKNOWN)) ?? null) === null,
    "…and no record key was written either");
}

/* a create with NO id still works, and its id is the SERVER's */
let realJobId = null;
{
  const r = await call("saveScheduledJob", { job: jobBody() });
  ok(r && r.success === true, `a create WITHOUT an id still succeeds (got ${JSON.stringify(r).slice(0, 200)})`);
  realJobId = r.success ? r.job.id : null;
  ok(!!realJobId && realJobId !== "job_does_not_exist_616", "…and the row carries a server-minted id");
}
/* …and an EDIT of a row that exists still works */
{
  const r = await call("saveScheduledJob", { job: jobBody({ id: realJobId, name: "F-616 job renamed" }) });
  ok(r && r.success === true && r.job.id === realJobId && r.job.name === "F-616 job renamed",
    `an edit of a REAL id still saves in place (got ${JSON.stringify(r && r.error)})`);
}
/* …and once it is DELETED, the same body is refused — the live scenario, offline */
{
  const del = await call("deleteScheduledJob", { id: realJobId });
  ok(del && del.success === true, "the job deletes");
  const again = await call("saveScheduledJob", { job: jobBody({ id: realJobId }) });
  ok(again && again.success === false && again.error === "Scheduled job not found",
    `a save re-using the DELETED id is refused — no resurrection (got ${JSON.stringify(again).slice(0, 200)})`);
  ok(!(await jobIndex()).find((x) => x.id === realJobId), "…and the deleted id is still absent from the index");
}

/* ═════ 2. LISTENERS — the twin that carried the same line ═════ */
{
  const UNKNOWN = "lst_does_not_exist_616";
  const r = await call("saveListener", { listener: listenerBody({ id: UNKNOWN }) });
  ok(r && r.success === false && r.error === "Listener not found",
    `an unknown listener id is REFUSED with its own sentence (got ${JSON.stringify(r).slice(0, 200)})`);
  ok(!(await listenerIndex()).find((x) => x.id === UNKNOWN), "…and no listener row was written");
}
{
  const created = await call("saveListener", { listener: listenerBody() });
  ok(created && created.success === true, "a listener create WITHOUT an id still succeeds");
  const edit = await call("saveListener", { listener: listenerBody({ id: created.listener.id, name: "renamed" }) });
  ok(edit && edit.success === true && edit.listener.name === "renamed", "…and an edit of a real id still saves");
}

/* ═════ 3. SKILLS — `saveSkillInternal` honours meta.id the same way ═════ */
{
  const r = await call("saveSkill", { id: "skill_never_existed_616", name: "Planted", instructions: "do a thing" });
  ok(r && r.success === false && r.error === "Skill not found",
    `an unknown skill id is REFUSED (got ${JSON.stringify(r).slice(0, 200)})`);
  const index = (await storage.get("skill_repo_index")) || [];
  ok(!index.find((s) => s.id === "skill_never_existed_616"), "…and no skill row was planted at that id");
  const made = await call("saveSkill", { name: "Real skill", instructions: "do a thing" });
  ok(made && made.success === true && made.id && made.id !== "skill_never_existed_616",
    "a skill create WITHOUT an id still succeeds, at a server-minted id");
  const edited = await call("saveSkill", { id: made.id, name: "Real skill II", instructions: "do a thing" });
  ok(edited && edited.success === true, "…and an edit of that id still saves");
}

/* ═════ 4. F-261 IS INTACT — no existence leak through the new refusal ═════
 *
 * The whole point of routing this through `gateExistingRow` rather than a bare
 * existence check: a scope-"own" editor must not be able to tell "that id is free"
 * from "that id is someone else's". Both answers must be the same bytes.
 */
{
  const mine = await call("saveScheduledJob", { job: jobBody({ name: "admin's job" }) }, ADMIN);
  const foreign = mine.job.id;
  const a = await call("saveScheduledJob", { job: jobBody({ id: foreign }) }, OWN);
  const b = await call("saveScheduledJob", { job: jobBody({ id: "job_free_616" }) }, OWN);
  ok(a.success === false && b.success === false, "a scope-'own' editor is refused on both ids");
  ok(JSON.stringify(a) === JSON.stringify(b),
    `…and the two refusals are byte-identical — ids stay unenumerable (a=${JSON.stringify(a)} b=${JSON.stringify(b)})`);
  ok(a.error !== "Scheduled job not found",
    "…and neither answer is the not-found sentence, which is reserved for scope-'all' callers");
}

console.log(`save-unknown-id (F-616): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
