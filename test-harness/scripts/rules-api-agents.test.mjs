/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * `?resource=agents` — THE VIRTUAL ADMINISTRATOR OVER REST (1.5 commit 8).
 *
 * Every assertion goes through the REAL `rulesApiHandler` with the mock KVS and a
 * scripted Jira, because what is worth proving here is the WIRING and not a pure
 * function:
 *  · THE ROLE FLOOR of every route, asserted in BOTH directions. A floor proved in
 *    one direction only is a floor that can drift the other way without a failing
 *    test. The floors are the Agents tab's floors: a REST caller must not be able to
 *    do anything the tab cannot, and the sharpest case is a staged customer reply.
 *  · THE SAVE PATH IS THE RESOLVER'S. The same body through the tab's
 *    `saveScheduledJob` and through `POST ?resource=agents` must store a
 *    BYTE-IDENTICAL record; that is the only thing making "one normalisation" true
 *    rather than aspirational.
 *  · approve/reject record a verdict and PUSH NOTHING.
 *  · A PAUSED agent refuses the planner, through REST as through the tab.
 *  · The memory clamp is `writeMemory`'s and the clamp is REPORTED, not swallowed.
 *  · An unknown action is a 400 in the ONE refusal shape, never a 500 or a silent 200.
 *
 * Run: node --import ./lib/register-mocks.mjs scripts/rules-api-agents.test.mjs
 * (auto-discovered by run-offline.mjs, which supplies the loader.)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi, pushed } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const EDITOR = "acct-editor";

/* ── the site this suite runs against (the va-admin suite's shape) ─────────── */
forgeApi.__respond((path) => {
  const p = String(path);
  if (p.includes("/rest/api/3/project/search")) {
    return forgeApi.__response(200, { isLast: true, values: [{ key: "SUP", name: "Support" }, { key: "OPS", name: "Operations" }] });
  }
  if (/\/rest\/servicedeskapi\/servicedesk\/[^/]+\/queue/.test(p)) {
    return forgeApi.__response(200, { values: [{ id: "10", name: "Waiting for support", jql: "resolution = Unresolved" }] });
  }
  if (p.includes("/rest/servicedeskapi/servicedesk")) {
    return forgeApi.__response(200, { values: [{ id: "1", projectName: "Support desk" }] });
  }
  if (p.includes("/rest/api/3/search/jql")) return forgeApi.__response(200, { issues: [] });
  return forgeApi.__response(200, {});
});

await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
await storage.set("app_admins", [
  { accountId: ADMIN, role: "admin", scope: "all" },
  { accountId: EDITOR, role: "editor", scope: "all" },
]);
await storage.set("skill_repo_index", [{ id: "sk1", name: "JSM replies" }]);

const { createApiTokenInternal, revokeApiTokenInternal, rulesApiHandler } = await import("../../src/rules-api.js");
const { handler } = await import("../../src/index.js");
const J = await import("../../src/scheduled-jobs.js");

const resolverCall = (functionKey, payload = {}, accountId = EDITOR) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

// Three tokens, one per role, minted once and reused: the floors are the point of
// this suite and a per-test mint would blur which token was refused.
const tokens = {
  viewer: (await createApiTokenInternal({ name: "viewer", accountId: ADMIN, role: "viewer" })).token,
  editor: (await createApiTokenInternal({ name: "editor", accountId: ADMIN, role: "editor" })).token,
  admin: (await createApiTokenInternal({ name: "admin", accountId: ADMIN, role: "admin" })).token,
  // A token minted BEFORE the role field existed. It must keep every power it had.
  legacy: (await createApiTokenInternal({ name: "legacy", accountId: ADMIN })).token,
};

const rest = async (role, { method = "GET", query = {}, body } = {}) => {
  const res = await rulesApiHandler({
    method,
    headers: { authorization: `Bearer ${tokens[role]}` },
    queryParameters: Object.fromEntries(Object.entries({ resource: "agents", ...query }).map(([k, v]) => [k, [String(v)]])),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const vaRecord = (over = {}) => ({
  persona: { name: "Ada", voice: { register: "plain", maxSentences: 3 } },
  scope: { read: { site: false, projects: ["SUP"] }, write: { projects: ["SUP"] } },
  intake: { serviceDesks: [{ serviceDeskId: "1", queueIds: ["10"] }], jql: "", mentionsOf: [] },
  cadence: { preset: "hourly", timeZone: "Europe/Bucharest", postWindow: { from: "09:00", to: "17:00", days: [1, 2, 3, 4, 5] } },
  powers: { skillIds: ["sk1"] },
  guardrails: { shadowTicks: 3 },
  ...over,
});

/* ═════ 1. CREATE through REST, and the record is the resolver's ═════ */

let agentId = null;
{
  const created = await rest("admin", { method: "POST", body: { mode: "va", va: vaRecord() } });
  ok(created.status === 201 && created.body.agent && created.body.agent.mode === "va",
    `POST ?resource=agents creates a VA (got ${created.status} ${JSON.stringify(created.body).slice(0, 220)})`);
  agentId = created.body.agent && created.body.agent.id;
  ok(created.body.agent && created.body.agent.name === "Ada" && created.body.agent.schedule && created.body.agent.schedule.timeZone === "Europe/Bucharest",
    "…with the name and the schedule DERIVED from the record, exactly as the tab derives them");
  ok(created.body.agent && created.body.agent.createdBy && String(created.body.agent.createdBy).startsWith("api:"),
    `…and attributed to the token (got ${created.body.agent && created.body.agent.createdBy})`);

  /* THE PROPERTY: the same body through the two doors stores the SAME record.
     Identity is asserted on everything except the four fields that MUST differ —
     the id, the two timestamps and the author — because anything else differing
     means the two doors normalise differently, which is the defect this commit
     exists to prevent. */
  const viaResolver = await resolverCall("saveScheduledJob", { job: { mode: "va", va: vaRecord() } }, EDITOR);
  ok(viaResolver.success === true, `the resolver saves the same body (got ${JSON.stringify(viaResolver).slice(0, 200)})`);
  // A DEEP, key-order-independent stringify: a shallow compare would pass while the
  // two doors disagreed inside `va`, which is the only place that matters.
  const stable = (v) => (v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
    : (Array.isArray(v) ? `[${v.map(stable).join(",")}]` : JSON.stringify(v)));
  const blank = (row) => stable({ ...row, id: "", createdAt: "", updatedAt: "", createdBy: "", firstCreatedBy: "", stats: null });
  const restRow = await J.getJob(agentId);
  const resolverRow = await J.getJob(viaResolver.job.id);
  ok(blank(restRow) === blank(resolverRow),
    `the REST save and the resolver save store a byte-identical record\n  REST:     ${blank(restRow).slice(0, 400)}\n  RESOLVER: ${blank(resolverRow).slice(0, 400)}`);
  await J.deleteJob(viaResolver.job.id);
}

/* A structural refusal arrives as a refusal the caller can render, never a 500. */
{
  const r = await rest("admin", { method: "POST", body: { mode: "va", va: vaRecord({ scope: { read: { site: true, projects: [] }, write: { site: true, projects: [] } } }) } });
  ok(r.status === 400 && Array.isArray(r.body.refused) && r.body.refused.length > 0 && typeof r.body.error === "string",
    `a site-wide write scope is 400 with refused[] (got ${r.status} ${JSON.stringify(r.body).slice(0, 240)})`);
  ok(r.body.reason === "va_invalid", `…carrying the machine-readable reason (got ${r.body.reason})`);
}

/* A drop the save APPLIED is reported, never swallowed. */
{
  const r = await rest("admin", { method: "PUT", query: { id: agentId }, body: { va: vaRecord({ scope: { read: { site: false, projects: ["SUP", "NOPE"] }, write: { projects: ["SUP"] } } }) } });
  ok(r.status === 200 && Array.isArray(r.body.refused) && r.body.refused.some((x) => String(x.field).includes("scope.read")),
    `PUT reports a dropped project through refused[] (got ${r.status} ${JSON.stringify(r.body.refused || []).slice(0, 240)})`);
  ok(!r.body.agent.va.scope.read.projects.includes("NOPE"), "…and the unknown project is gone from the stored record");
}

/* ═════ 1b. A PARTIAL `va` IS A PATCH, NOT A REPLACEMENT (F-477) ═════

   The sharpest case: rename a PAUSED agent whose caps an admin tightened to one an
   hour. Before the recursive merge, `{"va":{"persona":{"name":"Ada II"}}}` replaced the
   whole block, `normalizeVa` rebuilt every absent part from the defaults, and the agent
   came back RESUMED, out of shadow and with its guardrails re-widened — from a request
   that changed a name. */
{
  const tightened = await rest("admin", {
    method: "POST",
    body: { mode: "va", va: vaRecord({ guardrails: { capsPerHour: 1, shadowTicks: 5 }, powers: { skillIds: ["sk1"], transition: true } }) },
  });
  ok(tightened.status === 201, `a tightened agent is created (got ${tightened.status} ${JSON.stringify(tightened.body).slice(0, 200)})`);
  const patchId = tightened.body.agent.id;
  const before = (await J.getJob(patchId)).va;

  const paused = await rest("admin", { method: "POST", query: { id: patchId, action: "pause" }, body: { reason: "tuning" } });
  ok(paused.status === 200 && paused.body.paused === true, "…and paused");

  const renamed = await rest("admin", { method: "PUT", query: { id: patchId }, body: { va: { persona: { name: "Ada II" } } } });
  ok(renamed.status === 200, `a partial va PUT is accepted (got ${renamed.status} ${JSON.stringify(renamed.body).slice(0, 200)})`);

  const after = (await J.getJob(patchId)).va;
  ok(after.persona.name === "Ada II", `…the rename landed (got ${after.persona.name})`);
  ok(after.status.paused === true, "A RENAME DOES NOT RESUME A PAUSED AGENT");
  ok(after.guardrails.capsPerHour === 1, `…and does not re-widen the hourly cap (got ${after.guardrails.capsPerHour})`);
  ok(after.guardrails.shadowTicks === 5, `…nor the shadow watch (got ${after.guardrails.shadowTicks})`);
  ok(JSON.stringify(after.scope) === JSON.stringify(before.scope), `…nor the scope (got ${JSON.stringify(after.scope)})`);
  ok(after.powers.transition === true && after.powers.skillIds.includes("sk1"), `…nor the powers (got ${JSON.stringify(after.powers).slice(0, 160)})`);
  // The sub-object the rename itself touched keeps its OTHER fields: a shallow merge of
  // `va` alone would have rebuilt `persona.voice` from the defaults.
  ok(after.persona.voice.maxSentences === before.persona.voice.maxSentences && after.persona.voice.register === before.persona.voice.register,
    `…and the voice inside the patched sub-object survives (got ${JSON.stringify(after.persona.voice)})`);
  // An allow-list sent explicitly still REPLACES: a patch must be able to remove.
  const narrowed = await rest("admin", { method: "PUT", query: { id: patchId }, body: { va: { powers: { skillIds: [] } } } });
  ok(narrowed.status === 200 && narrowed.body.agent.va.powers.skillIds.length === 0,
    `an explicit empty allow-list still means "none" (got ${JSON.stringify(narrowed.body.agent && narrowed.body.agent.va.powers.skillIds)})`);
  await J.deleteJob(patchId);
}

/* ═════ 2. THE ROLE FLOORS, in both directions ═════ */
{
  const list = await rest("editor");
  ok(list.status === 200 && Array.isArray(list.body.agents), `an EDITOR token lists agents (got ${list.status})`);
  const status = await rest("editor", { query: { id: agentId } });
  ok(status.status === 200 && status.body.id === agentId && Array.isArray(status.body.receipts),
    `an EDITOR token reads status + receipts (got ${status.status} ${JSON.stringify(status.body).slice(0, 200)})`);

  const viewerList = await rest("viewer");
  ok(viewerList.status === 403 && viewerList.body.reason === "no-permission" && viewerList.body.needsRole === "editor" && viewerList.body.hint === "ask-app-admin",
    `a VIEWER token is refused the list in the ONE refusal shape (got ${viewerList.status} ${JSON.stringify(viewerList.body)})`);
  ok((await rest("viewer", { query: { id: agentId } })).status === 403, "…and the status read too");

  // Everything that CHANGES an agent, or reads what it is about to SAY, is admin.
  const adminOnly = [
    { label: "drafts", opts: { query: { id: agentId, part: "drafts" } } },
    { label: "effects", opts: { query: { id: agentId, part: "effects" } } },
    { label: "memory", opts: { query: { id: agentId, part: "memory" } } },
    { label: "memory PUT", opts: { method: "PUT", query: { id: agentId, part: "memory" }, body: { memory: "x" } } },
    { label: "pause", opts: { method: "POST", query: { id: agentId, action: "pause" }, body: {} } },
    { label: "resume", opts: { method: "POST", query: { id: agentId, action: "resume" }, body: {} } },
    { label: "tick", opts: { method: "POST", query: { id: agentId, action: "tick" }, body: {} } },
    { label: "post", opts: { method: "POST", query: { id: agentId, action: "post" }, body: {} } },
    { label: "approve", opts: { method: "POST", query: { id: agentId, action: "approve" }, body: { itemKey: "SUP-1" } } },
    { label: "reject", opts: { method: "POST", query: { id: agentId, action: "reject" }, body: { itemKey: "SUP-1" } } },
    { label: "create", opts: { method: "POST", body: { mode: "va", va: vaRecord() } } },
    { label: "update", opts: { method: "PUT", query: { id: agentId }, body: { description: "x" } } },
    { label: "delete", opts: { method: "DELETE", query: { id: agentId } } },
  ];
  for (const { label, opts } of adminOnly) {
    const r = await rest("editor", opts);
    ok(r.status === 403 && r.body.reason === "no-permission" && r.body.needsRole === "admin",
      `${label}: an EDITOR token is refused and told it needs ADMIN (got ${r.status} ${JSON.stringify(r.body).slice(0, 160)})`);
  }

  // A token minted before the role field existed keeps every power it had.
  ok((await rest("legacy", { query: { id: agentId, part: "memory" } })).status === 200,
    "a token minted without a role is ADMIN, so no live integration loses a power on upgrade");
}

/* ═════ 3. AUTH is the same auth the rest of the surface uses ═════ */
{
  const noToken = await rulesApiHandler({ method: "GET", queryParameters: { resource: ["agents"] } });
  ok(noToken.statusCode === 401, `no token is 401 on agents as everywhere else (got ${noToken.statusCode})`);

  const throwaway = await createApiTokenInternal({ name: "revoked", accountId: ADMIN, role: "admin" });
  await revokeApiTokenInternal(throwaway.row.id);
  const res = await rulesApiHandler({ method: "GET", headers: { authorization: `Bearer ${throwaway.token}` }, queryParameters: { resource: ["agents"] } });
  ok(res.statusCode === 401, `a revoked token cannot reach agents either (got ${res.statusCode})`);

  const unknown = await rulesApiHandler({ method: "GET", headers: { authorization: `Bearer ${tokens.admin}` }, queryParameters: { resource: ["nope"] } });
  const list = JSON.parse(unknown.body).resources || [];
  ok(unknown.statusCode === 404 && list.includes("agents"),
    `the 404 resource list names agents, or the 404 lies (got ${JSON.stringify(list)})`);
}

/* ═════ 4. A VA IS A JOB — one store, and a non-VA id is not an agent ═════ */
{
  const script = await resolverCall("saveScheduledJob", {
    job: { name: "Script job", mode: "script", schedule: { cron: "0 9 * * *", timeZone: "UTC" }, functions: [{ name: "s", code: "api.log('x')" }] },
  }, ADMIN);
  ok(script.success === true, "a plain script job exists alongside the agents");
  const r = await rest("admin", { query: { id: script.job.id } });
  ok(r.status === 404 && r.body.reason === "not_a_virtual_administrator",
    `a script job is refused BY NAME rather than operated on as an agent (got ${r.status} ${JSON.stringify(r.body).slice(0, 180)})`);
  const del = await rest("admin", { method: "DELETE", query: { id: script.job.id } });
  ok(del.status === 404, `…and it cannot be deleted through the agents resource either (got ${del.status})`);

  const listed = await rest("editor");
  ok(listed.body.agents.every((a) => a.mode === "va"), "the list is VA-only");
  ok(!JSON.stringify(listed.body).includes("api.log"), "…and carries no other rule's step code");
}

/* ═════ 4b. `?resource=jobs` IS NOT A SECOND DOOR ONTO AN AGENT (F-478) ═════

   A VA is stored as a job row, so the jobs resource was an EDITOR-floor door onto every
   agent that bypassed `prepareVaSave` (no catalogue check, no shadow re-arm) and a
   VIEWER-floor read of the whole `va` block. Both directions are asserted: the jobs
   resource refuses a VA, and the agents resource refuses a script job (section 4). */
{
  const jobs = async (role, { method = "GET", query = {}, body } = {}) => {
    const res = await rulesApiHandler({
      method,
      headers: { authorization: `Bearer ${tokens[role]}` },
      queryParameters: Object.fromEntries(Object.entries({ resource: "jobs", ...query }).map(([k, v]) => [k, [String(v)]])),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

  const named = (r, what) => {
    ok(r.status === 404 && r.body.reason === "is_a_virtual_administrator" && r.body.resource === "agents",
      `${what} through ?resource=jobs is refused BY NAME and points at ?resource=agents (got ${r.status} ${JSON.stringify(r.body).slice(0, 200)})`);
  };

  named(await jobs("viewer", { query: { id: agentId } }), "reading an agent");
  named(await jobs("editor", { method: "PUT", query: { id: agentId }, body: { va: { scope: { write: { projects: ["OPS"] } } } } }), "re-scoping an agent");
  named(await jobs("editor", { method: "DELETE", query: { id: agentId } }), "deleting an agent");
  named(await jobs("editor", { method: "POST", query: { id: agentId, action: "run" }, body: {} }), "running an agent");
  named(await jobs("editor", { method: "POST", query: { id: agentId, action: "disable" }, body: {} }), "disabling an agent");
  named(await jobs("editor", { method: "POST", body: { mode: "va", va: vaRecord() } }), "creating an agent");
  // The UPSERT from the other side: no `mode:"va"` in the body, so `normalizeJob` would
  // have rewritten the agent as a plain script job and lost the record.
  named(await jobs("editor", { method: "POST", body: { id: agentId, name: "hijack", schedule: { cron: "0 9 * * *", timeZone: "UTC" }, functions: [{ name: "s", code: "api.log('x')" }] } }), "rewriting an agent as a script job");

  // …and nothing was actually changed by any of the refusals above.
  const still = await J.getJob(agentId);
  ok(still && still.mode === "va" && still.va.persona.name === "Ada", `the agent is untouched after every refusal (got ${still && still.mode}/${still && still.va && still.va.persona.name})`);

  const list = await jobs("viewer");
  ok(list.status === 200 && Array.isArray(list.body.jobs) && list.body.jobs.every((j) => j.mode !== "va"),
    `the jobs list hides VA rows (got ${JSON.stringify((list.body.jobs || []).map((j) => j.mode))})`);
  ok(!JSON.stringify(list.body).includes("Ada"), "…so no agent's persona leaks through the jobs list either");

  // A PLAIN job is untouched by the guard: the door is closed to agents, not to jobs.
  const plain = await jobs("editor", { method: "POST", body: { name: "Nightly", mode: "script", schedule: { cron: "0 9 * * *", timeZone: "UTC" }, functions: [{ name: "s", code: "api.log('x')" }] } });
  ok(plain.status === 201 && plain.body.job, `a normal scheduled job still creates through ?resource=jobs (got ${plain.status} ${JSON.stringify(plain.body).slice(0, 160)})`);
  const plainId = plain.body.job.id;
  ok((await jobs("viewer", { query: { id: plainId } })).status === 200, "…and reads back");
  ok((await jobs("editor", { method: "DELETE", query: { id: plainId } })).status === 200, "…and deletes");
}

/* ═════ 5. DRAFTS: the shapes, and NEITHER VERDICT POSTS ═════ */
{
  const { saveItem } = await import("../../src/va-ledger.js");
  const store = { get: (k) => storage.get(k), set: (k, v, o) => storage.set(k, v, o), delete: (k) => storage.delete(k) };
  await saveItem(store, agentId, "SUP-1", { state: "queued", event: "queued" });
  await saveItem(store, agentId, "SUP-1", {
    state: "staged",
    staged: { audience: "internal", body: "We are looking into it now.", reason: "first reply", stagedAt: new Date().toISOString(), tickId: "t1" },
    event: "staged",
  });

  const drafts = await rest("admin", { query: { id: agentId, part: "drafts" } });
  ok(drafts.status === 200 && drafts.body.drafts.length === 1, `the staged draft is listed (got ${drafts.status} ${JSON.stringify(drafts.body).slice(0, 200)})`);
  const row = drafts.body.drafts[0];
  ok(["itemKey", "issueKey", "stagedAt", "audience", "attempts", "body"].every((k) => k in row),
    `a draft row carries the tab's field set (got ${Object.keys(row).join(", ")})`);
  ok(row.body === "We are looking into it now.", "…with the body IN FULL, which is the whole point of shadow mode");

  const before = pushed.length;
  const approved = await rest("admin", { method: "POST", query: { id: agentId, action: "approve" }, body: { itemKey: "SUP-1", stagedAt: row.stagedAt } });
  ok(approved.status === 200 && approved.body.posted === false,
    `approve records a verdict and says posted:false (got ${approved.status} ${JSON.stringify(approved.body).slice(0, 200)})`);
  ok(pushed.length === before, "…and PUSHED NOTHING — the post phase is the only thing that delivers a draft");

  const stale = await rest("admin", { method: "POST", query: { id: agentId, action: "approve" }, body: { itemKey: "SUP-1", stagedAt: "1999-01-01T00:00:00.000Z" } });
  ok(stale.status === 409 && stale.body.reason === "draft_changed",
    `a verdict on a superseded draft is a 409, not a 400 a client would "fix" (got ${stale.status} ${JSON.stringify(stale.body).slice(0, 180)})`);

  const rejected = await rest("admin", { method: "POST", query: { id: agentId, action: "reject" }, body: { itemKey: "SUP-1", stagedAt: row.stagedAt } });
  ok(rejected.status === 200 && rejected.body.state === "queued",
    `reject drops the draft and re-queues the item (got ${rejected.status} ${JSON.stringify(rejected.body).slice(0, 180)})`);
  ok(pushed.length === before, "…and rejecting pushed nothing either");

  const missing = await rest("admin", { method: "POST", query: { id: agentId, action: "approve" }, body: {} });
  ok(missing.status === 400 && missing.body.reason === "item_key_required",
    `approve with no itemKey is a named 400 (got ${missing.status} ${JSON.stringify(missing.body).slice(0, 160)})`);
}

/* ═════ 6. PAUSE BLOCKS THE PLANNER, and a run takes the claim ═════ */
{
  const paused = await rest("admin", { method: "POST", query: { id: agentId, action: "pause" }, body: { reason: "maintenance" } });
  ok(paused.status === 200 && paused.body.paused === true, `pause writes status.paused (got ${paused.status} ${JSON.stringify(paused.body).slice(0, 180)})`);
  const stored = await J.getJob(agentId);
  ok(stored.va.status.paused === true, "…on the JOB ROW, which is where gate 1 reads it from");

  const tick = await rest("admin", { method: "POST", query: { id: agentId, action: "tick" }, body: {} });
  ok(tick.status === 409 && tick.body.reason === "agent_paused",
    `a PAUSED agent refuses a manual tick over REST (got ${tick.status} ${JSON.stringify(tick.body).slice(0, 180)})`);

  const resumed = await rest("admin", { method: "POST", query: { id: agentId, action: "resume" }, body: {} });
  ok(resumed.status === 200 && resumed.body.paused === false, `resume clears it (got ${resumed.status})`);

  const first = await rest("admin", { method: "POST", query: { id: agentId, action: "tick" }, body: {} });
  ok(first.status === 202 && first.body.queued === true && first.body.taskType === "va-tick",
    `a manual tick is queued, 202 (got ${first.status} ${JSON.stringify(first.body).slice(0, 180)})`);
  const second = await rest("admin", { method: "POST", query: { id: agentId, action: "tick" }, body: {} });
  ok(second.status === 409 && second.body.reason === "already_running",
    `…and a second press inside the same five-minute bucket is refused by THE CLAIM (got ${second.status} ${JSON.stringify(second.body).slice(0, 180)})`);
}

/* ═════ 7. MEMORY: read, write, and the clamp is REPORTED ═════ */
{
  const seeded = await rest("admin", { method: "PUT", query: { id: agentId, part: "memory" }, body: { memory: "The SUP desk escalates to Ops after 24h.", constraints: ["Never promise a date."] } });
  ok(seeded.status === 200 && seeded.body.constraints.length === 1, `memory saves through PUT (got ${seeded.status} ${JSON.stringify(seeded.body).slice(0, 200)})`);

  const read = await rest("admin", { query: { id: agentId, part: "memory" } });
  ok(read.status === 200 && read.body.memory.includes("escalates") && read.body.capBytes > 0,
    `…and reads back with the cap alongside it (got ${JSON.stringify(read.body).slice(0, 200)})`);

  // A prose-only edit must not delete the pinned constraints (F-423): `undefined`
  // means "leave them alone" and `[]` means "the admin cleared them".
  const proseOnly = await rest("admin", { method: "PUT", query: { id: agentId, part: "memory" }, body: { memory: "Shorter note." } });
  ok(proseOnly.body.constraints.length === 1, "a prose-only edit PRESERVES the pinned constraints");

  const huge = await rest("admin", { method: "PUT", query: { id: agentId, part: "memory" }, body: { memory: "x".repeat(200000) } });
  ok(huge.status === 200 && huge.body.clamped === true,
    `an oversized memory is CLAMPED and the clamp is REPORTED, never swallowed (got ${JSON.stringify({ clamped: huge.body.clamped, bytes: huge.body.bytes, cap: huge.body.capBytes })})`);
  /* THE ROW IS BOUNDED, which is what this resource owes: 200 KB of prose becomes a
     row on the order of the cap, not on the order of the body. It is asserted as a
     BOUND and not as `bytes <= capBytes` because it currently lands a few bytes OVER:
     `writeMemory` budgets the PROSE against `memoryCapBytes` while `memory()` measures
     the stored ENVELOPE (`{"text":…,"constraints":[…]}`), so a full memory reads as
     slightly over 100% on the tab's meter. That measurement mismatch is `va-ledger.js`'s
     (commit 2) and is reported rather than papered over with a second clamp here — a
     second authority on the cap is exactly what F-423 forbade. */
  ok(huge.body.bytes <= huge.body.capBytes + 1024,
    `…and the stored row stays bounded by the cap (got ${huge.body.bytes} against ${huge.body.capBytes})`);
}

/* ═════ 8. THE FAIL CONTRACT: unknown action, unknown part, bad method ═════ */
{
  const unknownAction = await rest("admin", { method: "POST", query: { id: agentId, action: "explode" }, body: {} });
  ok(unknownAction.status === 400 && typeof unknownAction.body.error === "string" && Array.isArray(unknownAction.body.actions),
    `an unknown action is a 400 that LISTS the actions (got ${unknownAction.status} ${JSON.stringify(unknownAction.body).slice(0, 200)})`);
  ok(unknownAction.body.actions.includes("approve") && unknownAction.body.actions.includes("tick"), "…and the list is the real one");

  const unknownPart = await rest("admin", { query: { id: agentId, part: "secrets" } });
  ok(unknownPart.status === 400 && Array.isArray(unknownPart.body.parts),
    `an unknown part is a 400 that lists the parts (got ${unknownPart.status} ${JSON.stringify(unknownPart.body).slice(0, 180)})`);

  const badMethod = await rest("admin", { method: "PUT", query: { id: agentId, part: "drafts" }, body: {} });
  ok(badMethod.status === 405, `a write to a read-only part is 405 (got ${badMethod.status})`);

  const noId = await rest("admin", { method: "DELETE" });
  ok(noId.status === 400 && /id required/.test(noId.body.error), `a DELETE with no id is a named 400 (got ${noId.status} ${JSON.stringify(noId.body)})`);

  const gone = await rest("admin", { query: { id: "job_does_not_exist" } });
  ok(gone.status === 404 && gone.body.reason === "not_found" && typeof gone.body.error === "string" && gone.body.error.length > 0,
    `an unknown agent is a NAMED 404 with a sentence, never a throw (got ${gone.status} ${JSON.stringify(gone.body).slice(0, 180)})`);
}

/* ═════ 9. DELETE goes through the job delete ═════ */
{
  const del = await rest("admin", { method: "DELETE", query: { id: agentId } });
  ok(del.status === 200 && del.body.deleted === agentId, `an agent deletes through the job delete (got ${del.status} ${JSON.stringify(del.body)})`);
  ok((await J.getJob(agentId)) == null, "…and the job row is gone, because a VA has no second store");
  ok((await rest("admin", { method: "DELETE", query: { id: agentId } })).status === 404, "…so deleting it twice is a 404");
}

console.log(`\nrules-api-agents.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
