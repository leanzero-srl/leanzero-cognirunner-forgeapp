/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE THREE CAPABILITY SEAMS THAT DID NOT REACH THE ONE FACT READER (F-485).
 *
 * `agentGateFacts` in src/index.js assembles the four facts the agent gate decides
 * from (provider, edition, agent model, allowance level). It was PRIVATE, and three
 * surfaces outside that file needed it:
 *
 *   a) src/rules-api.js supplied NO gate context at all, so `assertAllowedActions`
 *      ran against the restrictive default and THREW on any capability-gated action.
 *      A rule an admin legitimately armed with a repository action was therefore
 *      PERMANENTLY un-editable over REST — a rename came back 400 — on an instance
 *      where the capability IS enabled (F-480).
 *   b) `prepareVaSave` (src/va-admin.js) accepted a Virtual Administrator on an
 *      instance that may not run one, so the refusal arrived as a tick receipt five
 *      minutes later instead of on the form (F-482).
 *   c) `src/virtual-admin.js`'s capability dep re-assembled the facts itself and could
 *      not read the allowance (the maths was private to index.js), so the
 *      `allowance-exhausted` arm of the predicate could never fire on that surface —
 *      a tenant whose month was spent kept running its agent on the vendor's bill.
 *
 * BOTH DIRECTIONS, because a gate proved one way drifts the other way in silence. The
 * provider memo in src/index.js is 30 s with no test seam, so the two worlds cannot be
 * flipped mid-process: the CAPABILITY-OFF half is a re-exec of this file with
 * CAP_OFF=1, which seeds the instance BEFORE index.js is imported (the pattern
 * premade-coder-pf.test.mjs established).
 *
 * The OFF world is deliberately an EXHAUSTED ALLOWANCE rather than a Standard edition:
 * it is the arm that could not fire at all before this, so it is the arm that proves
 * the allowance now travels with the other three facts.
 *
 * Run: node --import ../lib/register-mocks-index.mjs scripts/agent-capability-seams.test.mjs
 * (auto-discovered by run-offline.mjs, which supplies the loader.)
 */

import "../lib/register-mocks-index.mjs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);

const CAP_OFF = process.env.CR_CAP_SEAMS_OFF === "1";
const world = CAP_OFF ? "OFF" : "ON";

const ADMIN = "acct-admin";

/* ═════ F-811 — THE TWO ARMS OF THE CAPABILITY ANSWER MUST NEVER SPLIT ═════
 *
 * The capability question has TWO doors on one instance, and until F-811 they could
 * answer opposite things about it:
 *
 *   the STATUS arm — `getAgentCapability` (src/index.js), what the admin panel's Code
 *     tab and the listener checklist render; it read `agentGateFacts` MEMOISED.
 *   the SAVE arm — `vaCapabilityVerdict` (src/virtual-admin.js), which the VA save door
 *     (src/va-admin.js) and the tick ride; FRESH since F-485.
 *
 * And `agentGateFacts` was only HALF freshenable: `fresh:true` re-read the provider, the
 * allowance and the edition without the 30 s memo, but the agent MODEL always came from
 * `getAgentModel()`, which resolved a provider OF ITS OWN through that same memo. So one
 * fact set could be half one provider and half another. Measured on staging: the memo
 * held `managed` after the provider row was deleted, the status card said
 * enabled/`managed` with agentModel `anthropic/claude-sonnet-5`, and the fresh arm read
 * provider `atlassian` (an absent row defaults there) with that SAME managed model id and
 * refused `needs-frontier-model`. The permissive answer was the one the user could see.
 *
 * These cases are CHILD PROCESSES (`CR_F811_CASE`), because the 30 s provider memo in
 * src/index.js has no test seam and cannot be flipped once the file has read it — the
 * same reason this suite already re-execs itself for the capability-OFF world. Each case
 * seeds its instance BEFORE src/index.js is imported and then asks BOTH doors.
 *
 * THE PROPERTY IS AGREEMENT, not a particular verdict: every case asserts that the two
 * arms return the same `enabled`, the same `reason` and the same `agentModel`. The
 * expected reason is asserted too, so "they agree because both broke" cannot pass.
 */

const seedF811Common = async () => {
  await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });
  await storage.set("COGNIRUNNER_SEAT_SNAPSHOT", { seats: 10, at: new Date().toISOString() });
  await storage.set("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);
};

/** The STATUS arm, through the real resolver door (permission gate included). */
const f811StatusArm = async () => {
  const { handler } = await import("../../src/index.js");
  return handler({ call: { functionKey: "getAgentCapability", payload: {} }, context: {} }, { principal: { accountId: ADMIN } });
};

/** The SAVE arm, through the function the VA save door and the tick both ride. */
const f811SaveArm = async () => (await import("../../src/virtual-admin.js")).vaCapabilityVerdict();

const f811Agree = async (label, expected) => {
  const status = await f811StatusArm();
  const save = await f811SaveArm();
  eq(status.enabled, save.enabled, `${label}: the STATUS arm and the SAVE arm agree on enabled`);
  eq(status.reason, save.reason, `${label}: …and on the reason`);
  eq(String(status.agentModel), String(save.agentModel),
    `${label}: …and on the AGENT MODEL, which is the fact that used to cross providers`);
  eq(status.reason, expected.reason, `${label}: …and the reason is the one this instance earns`);
  eq(status.enabled, expected.enabled, `${label}: …and the verdict is the one this instance earns`);
  if (expected.provider !== undefined) eq(status.provider, expected.provider, `${label}: …on the provider this instance really has`);
  if (expected.agentModel !== undefined) eq(String(status.agentModel), expected.agentModel, `${label}: …naming a model that provider can actually run`);
  return { status, save };
};

const runF811Case = async (name) => {
  await seedF811Common();
  if (name === "cold-no-row") {
    // BLOCK — no provider row and no model slot at all, on a COLD container: an absent
    // row defaults to `atlassian`, whose default model is Haiku, which never drives an
    // agent. The point is that both doors say so.
    await f811Agree("F-811.BLOCK_cold", { enabled: false, reason: "needs-frontier-model", provider: "atlassian", agentModel: "claude-haiku-4-5-20251001" });
    return;
  }
  if (name === "memo-managed-row-deleted") {
    // THE REGRESSION, and the measured one. Prime the 30 s memo with `managed`, then
    // delete the provider row underneath it. The memo now holds a provider the instance
    // no longer has; the fresh arm sees `atlassian`. Before F-811 the status arm answered
    // enabled/`managed` here while the save arm refused `needs-frontier-model`.
    await storage.set("COGNIRUNNER_AI_PROVIDER", "managed");
    const { handler, readProviderConfigFresh } = await import("../../src/index.js");
    // The primer: this resolver resolves the ACTIVE provider's ordinary model, which goes
    // through getProviderConfig() and stamps the memo. Nothing else here writes it.
    await handler({ call: { functionKey: "getAgentModel", payload: {} }, context: {} }, { principal: { accountId: ADMIN } });
    await storage.delete("COGNIRUNNER_AI_PROVIDER");
    eq((await readProviderConfigFresh()).provider, "atlassian", "F-811.REGRESSION: the row really is gone — a fresh read says atlassian");
    await f811Agree("F-811.REGRESSION_memo_managed", { enabled: false, reason: "needs-frontier-model", provider: "atlassian", agentModel: "claude-haiku-4-5-20251001" });
    return;
  }
  if (name === "managed-null-slot" || name === "managed-junk-slot" || name === "managed-opus") {
    // ALLOW — the managed engine on Coder is capable whatever the slot holds, because
    // every id in the offer is a frontier model and anything else is CLAMPED to Sonnet 5
    // server-side. A junk slot must not be able to turn the agent off, and it must not be
    // able to name a model outside the offer on either door.
    await storage.set("COGNIRUNNER_AI_PROVIDER", "managed");
    if (name === "managed-junk-slot") await storage.set("COGNIRUNNER_AGENT_MODEL_managed", "totally/bogus-9");
    if (name === "managed-opus") await storage.set("COGNIRUNNER_AGENT_MODEL_managed", "anthropic/claude-opus-5");
    await f811Agree(`F-811.ALLOW_${name}`, {
      enabled: true,
      reason: "managed",
      provider: "managed",
      agentModel: name === "managed-opus" ? "anthropic/claude-opus-5" : "anthropic/claude-sonnet-5",
    });
    return;
  }
  if (name === "atlassian-vendor-prefixed") {
    // BLOCK — a Forge LLM instance whose agent slot still holds the OpenRouter-namespaced
    // id a `managed` stint wrote. The gate is exact-id, so this could only ever be
    // refused; the belt makes both doors refuse it while naming the model Forge LLM would
    // actually run, instead of naming another vendor's id. NOT a prefix strip:
    // "anthropic/claude-opus-5" does not become "claude-opus-5", because the exact-id
    // policy in src/shared/edition.js is a pricing decision.
    await storage.set("COGNIRUNNER_AI_PROVIDER", "atlassian");
    await storage.set("COGNIRUNNER_AGENT_MODEL_atlassian", "anthropic/claude-opus-5");
    await f811Agree("F-811.BLOCK_atlassian_vendor_prefixed", { enabled: false, reason: "needs-frontier-model", provider: "atlassian", agentModel: "claude-haiku-4-5-20251001" });
    return;
  }
  fail++; console.log("FAIL: unknown F-811 case", name);
};

const F811_CASE = process.env.CR_F811_CASE || "";
if (F811_CASE) {
  await runF811Case(F811_CASE);
  console.log(`agent capability F-811 [${F811_CASE}]: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

/* ═════ F-811 — THE SOURCE SHAPE THAT KEEPS THE TWO ARMS TOGETHER ═════
 *
 * The behavioural cases above prove today's answers agree. These two assertions are what
 * stop the NEXT call site re-splitting them, because a freshness policy is invisible at
 * the call site and a `getAgentModel()` inside the fact reader looks harmless.
 *
 * THE POLICY, chosen here and stated in the docblock on `agentGateFacts`: every ANSWER
 * and every SAVE door reads `{fresh:true}`, because the other half of the same answer
 * already does — `vaCapabilityVerdict` has been fresh since F-485, and `prepareVaSave`
 * rides it INSIDE THE SAME saveScheduledJob request as the action gate at :11454. One
 * request, two arms; a memo on one of them is a verdict that contradicts itself. The ONE
 * exception is the RUN-TIME gate at the transition site, which is neither arm of that
 * pair and runs per transition, so it keeps the memo and says so IN PLACE — that marker
 * is what this assertion matches, so an unmarked cached call site fails the run.
 */
{
  const idxSrc = readFileSync(path.join(fileURLToPath(new URL("../../src/index.js", import.meta.url))), "utf8");
  const idxCode = idxSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const lines = idxCode.split("\n").filter((l) => /agentGateFacts\(/.test(l) && !/const agentGateFacts/.test(l) && !/^\s*agentGateFacts,\s*$/.test(l));
  ok(lines.length >= 6, `F-811.SHAPE: found ${lines.length} agentGateFacts call sites in src/index.js`);
  const cached = lines.filter((l) => !/fresh:\s*true/.test(l));
  ok(cached.length === 1, `F-811.SHAPE: exactly ONE call site is memoised (got ${cached.length}: ${cached.map((l) => l.trim()).join(" | ")})`);
  ok(cached.every((l) => /F-811 HOT PATH: memoised on purpose/.test(l)),
    `F-811.SHAPE: …and it is the RUN-TIME one, marked in place (got ${cached.map((l) => l.trim()).join(" | ")})`);
  const gf = (idxCode.match(/const agentGateFacts = async \(context, \{ fresh = false \} = \{\}\) => \{[\s\S]*?\n\};/) || [, ""])[0] || "";
  ok(gf.length > 0, "F-811.SHAPE: found agentGateFacts");
  ok(/getAgentModelFor\(facts\.provider\)/.test(gf),
    "F-811.SHAPE: the agent model is resolved FOR THIS FACT SET'S PROVIDER");
  ok(!/[^A-Za-z]getAgentModel\(\)/.test(gf),
    "F-811.SHAPE: …and there is no bare getAgentModel() left in it — that is the call that read a provider of its own");
}

/* ── THE INSTANCE, seeded before src/index.js is ever imported ─────────────────
 *
 * ON  — a BYOK provider: `agentCapability` answers `{enabled:true, reason:"byok"}`
 *       whatever the edition is, which is the ordinary paying customer.
 * OFF — Forge LLM, Coder edition, a FRONTIER agent model, and a month that is spent.
 *       Every arm of the predicate passes except the allowance, so the verdict can
 *       only be `allowance-exhausted` — the arm F-485 made reachable.
 */
await storage.set("COGNIRUNNER_AI_PROVIDER", CAP_OFF ? "atlassian" : "openai");
await storage.set("COGNIRUNNER_OPENAI_KEY", "sk-test");
await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });
await storage.set("COGNIRUNNER_AGENT_MODEL_atlassian", "claude-sonnet-5");
await storage.set("COGNIRUNNER_SEAT_SNAPSHOT", { seats: 10, at: new Date().toISOString() });
if (CAP_OFF) {
  // A month whose Forge LLM estimate is far past any per-seat ceiling. The shape is
  // the usage ledger's own (`emptyState` + this month's key), so `summarizeState`
  // reads it as the CURRENT month rather than rolling it into history.
  const { emptyState, monthKey } = await import("../../src/shared/usage-meter.js");
  const state = emptyState();
  state.month.key = monthKey(Date.now());
  state.month.forgeLlm.estUsd = 99999;
  await storage.set("COGNIRUNNER_USAGE", state);
}
await storage.set("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);
await storage.set("skill_repo_index", [{ id: "sk1", name: "JSM replies" }]);

forgeApi.__respond((p) => {
  const s = String(p);
  if (s.includes("/rest/api/3/project/search")) return forgeApi.__response(200, { isLast: true, values: [{ key: "SUP", name: "Support" }] });
  if (/\/rest\/servicedeskapi\/servicedesk\/[^/]+\/queue/.test(s)) return forgeApi.__response(200, { values: [{ id: "10", name: "Waiting for support", jql: "resolution = Unresolved" }] });
  if (s.includes("/rest/servicedeskapi/servicedesk")) return forgeApi.__response(200, { values: [{ id: "1", projectName: "Support desk" }] });
  if (s.includes("/rest/api/3/search/jql")) return forgeApi.__response(200, { issues: [] });
  return forgeApi.__response(200, {});
});

const { buildAgentGateContext } = await import("../../src/shared/agent-actions.js");
const { createApiTokenInternal, rulesApiHandler } = await import("../../src/rules-api.js");
const L = await import("../../src/listeners.js");
const VA = await import("../../src/va-admin.js");
const V = await import("../../src/virtual-admin.js");
const LEDGER = await import("../../src/va-ledger.js");

const tokens = {
  // The EDITOR token is the F-480 story (a rename that must succeed); the ADMIN token
  // is the only role `?resource=agents` accepts for a write, and that floor is not what
  // this suite is testing.
  editor: (await createApiTokenInternal({ name: "editor", accountId: ADMIN, role: "editor" })).token,
  admin: (await createApiTokenInternal({ name: "admin", accountId: ADMIN, role: "admin" })).token,
};

const rest = async (resource, { method = "GET", query = {}, body, role = "editor" } = {}) => {
  const res = await rulesApiHandler({
    method,
    headers: { authorization: `Bearer ${tokens[role]}` },
    queryParameters: Object.fromEntries(Object.entries({ resource, ...query }).map(([k, v]) => [k, [String(v)]])),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

/* ═════ (a) F-480 — AN EDITOR TOKEN RENAMES A LISTENER THAT HOLDS A GATED ACTION ═════
 *
 * The row is armed THROUGH THE ENGINE with a capable gate context, which is the story:
 * an admin turned the action on when the instance could have it. The question this
 * suite asks is whether the REST door can then still EDIT that row — an unrelated
 * rename — on each kind of instance.
 */
const CAPABLE_GATE = buildAgentGateContext({ provider: "openai", edition: "advanced", agentModel: "gpt-5.4", allowanceLevel: null, savedByRole: "admin" });
const armed = await L.saveListener({
  id: "lst_gated",
  name: "PR watcher",
  events: ["avi:jira:created:issue"],
  mode: "agent",
  agent: { instructions: "Watch it.", allowedActions: ["get_pull_request"] },
}, { accountId: ADMIN, gate: CAPABLE_GATE, savedByRole: "admin" });
ok(Array.isArray(armed.agent.allowedActions) && armed.agent.allowedActions.includes("get_pull_request"),
  `the fixture row really does hold the gated action (got ${JSON.stringify(armed.agent.allowedActions)})`);

{
  const renamed = await rest("listeners", { method: "PUT", query: { id: "lst_gated" }, body: { name: "PR watcher (renamed)" } });
  if (!CAP_OFF) {
    eq(renamed.status, 200, "capability.ALLOW_rest_rename — a rename over REST succeeds on a capable instance (F-480)");
    eq(renamed.body.listener && renamed.body.listener.name, "PR watcher (renamed)", "…and the rename actually took");
    ok(renamed.body.listener && Array.isArray(renamed.body.listener.agent.allowedActions)
      && renamed.body.listener.agent.allowedActions.includes("get_pull_request"),
      `…and the gated action SURVIVES the edit rather than being silently dropped (got ${JSON.stringify(renamed.body.listener && renamed.body.listener.agent.allowedActions)})`);
  } else {
    eq(renamed.status, 400, "capability.BLOCK_rest_rename — on an INCAPABLE instance the same edit is still refused");
    eq(renamed.body.reason, "action-not-allowed", "…by name, so a client can act on it");
    ok(Array.isArray(renamed.body.refused) && renamed.body.refused.some((r) => r.id === "get_pull_request"),
      `…naming the action and why (got ${JSON.stringify(renamed.body.refused)})`);
  }
}

/* ═════ (b) F-482 — THE VIRTUAL ADMINISTRATOR SAVE DOOR ═════ */

const vaRecord = {
  persona: { name: "Ada", voice: { register: "plain", maxSentences: 3 } },
  scope: { read: { site: false, projects: ["SUP"] }, write: { projects: ["SUP"] } },
  intake: { serviceDesks: [{ serviceDeskId: "1", queueIds: ["10"] }], jql: "", mentionsOf: [] },
  cadence: { preset: "hourly", timeZone: "Europe/Bucharest", postWindow: { from: "09:00", to: "17:00", days: [1, 2, 3, 4, 5] } },
  powers: { skillIds: ["sk1"] },
  guardrails: { shadowTicks: 3 },
};

{
  const prepared = await VA.prepareVaSave({ input: { mode: "va", va: vaRecord }, existing: null, savedByRole: "admin" });
  if (!CAP_OFF) {
    eq(prepared.ok, true, `capability.ALLOW_va_save — a capable instance still saves an agent (got ${JSON.stringify(prepared).slice(0, 200)})`);
  } else {
    eq(prepared.ok, false, "capability.BLOCK_va_save — an incapable instance refuses the SAVE, not just the tick");
    eq(prepared.reason, "agent_capability_off", "…by name");
    eq(prepared.agentDisabled, true, "…in the `agentDisabled` shape the Coder's gate uses, so the tab can render the banner");
    eq(prepared.capability && prepared.capability.reason, "allowance-exhausted",
      "…carrying the capability reason the ALLOWANCE arm produced (F-485's whole point)");
    ok(!/\[object Object\]/.test(String(prepared.message || "")),
      `…and the sentence is a sentence, not a stringified copy row (got ${String(prepared.message || "").slice(0, 120)})`);
  }
}

{
  // BOTH DOORS. The REST resource is the other skin over the same function, and a
  // refusal it renders differently is a refusal two clients disagree about.
  const created = await rest("agents", { role: "admin", method: "POST", body: { mode: "va", va: vaRecord } });
  if (!CAP_OFF) {
    eq(created.status, 201, `capability.ALLOW_va_rest — the REST door creates the agent too (got ${JSON.stringify(created.body).slice(0, 200)})`);
  } else {
    eq(created.status, 409, "capability.BLOCK_va_rest — a CONFLICT, because nothing in the body would fix it");
    eq(created.body.reason, "agent_capability_off", "…the same reason the resolver door gives");
    eq(created.body.agentDisabled, true, "…and the same machine-readable flag");
  }
}

/* ═════ (c) F-485 — THE ALLOWANCE ARM CAN FIRE ON THE VA RUNTIME ═════ */

{
  const verdict = await V.vaCapabilityVerdict();
  if (!CAP_OFF) {
    eq(verdict.enabled, true, "capability.ALLOW_verdict — a BYOK instance is capable");
  } else {
    eq(verdict.enabled, false, "capability.BLOCK_verdict — a spent month is not capable");
    eq(verdict.reason, "allowance-exhausted", "…and the reason is the ALLOWANCE, which this surface could not see before");
    eq(verdict.allowanceLevel, "hard", "…because the allowance level now travels with the other three facts");
  }
}

{
  // THE TICK, with the PRODUCTION capability dep (deliberately not injected): this is
  // the seam, so a fixture verdict here would prove nothing.
  const job = {
    id: "job_vacap", mode: "va", name: "Ada", enabled: true,
    va: { ...vaRecord, status: { paused: false, shadowUntilTick: 0 }, intake: { ...vaRecord.intake, jql: "status = Open" } },
  };
  let searched = 0;
  const r = await V.runVaTick({ job, tickId: "cap-1", deps: {
    store: (await import("../lib/mock-kvs.mjs")).default,
    selfAccountId: async () => ({ ok: true, accountId: "app-user" }),
    jsmQueueIssues: async () => ({ ok: true, issues: [] }),
    searchJql: async () => { searched++; return { issues: [] }; },
    pushTask: async () => {},
  } });
  if (CAP_OFF) {
    eq(r.ok, false, "capability.BLOCK_tick — the tick refuses on the real verdict");
    eq(r.reason, "capability_off", "…by name");
    eq(searched, 0, "capability.BLOCK_spend — and it costs no search");
    const receipt = (await LEDGER.readTick(storage, "job_vacap", "cap-1", "prepare")).receipt;
    eq(receipt && receipt.skipped[0].gate, "capability", "capability: the RECEIPT names the gate");
    eq(receipt && receipt.skipped[0].reason, "allowance-exhausted",
      "…and names the ALLOWANCE as the reason — the arm that could never fire here before F-485");
  } else {
    ok(r.reason !== "capability_off", `capability.ALLOW_tick — a capable instance is not refused by the gate (got ${JSON.stringify(r).slice(0, 160)})`);
  }
}

console.log(`agent capability seams (F-485, world ${world}): ${pass} passed, ${fail} failed`);

/* F-811 — one child per instance shape, for the same reason the OFF world is a child:
 * the 30 s provider memo cannot be flipped once index.js has read it. */
if (!CAP_OFF && fail === 0) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const c of ["cold-no-row", "memo-managed-row-deleted", "managed-null-slot", "managed-junk-slot", "managed-opus", "atlassian-vendor-prefixed"]) {
    const env = { ...process.env, CR_F811_CASE: c };
    // The managed arms need the vendor engine to LOOK deployed, or every one of them
    // answers `managed-key-missing` and proves nothing about the model. The value is a
    // placeholder: `managedCloudStatus()` reports a boolean and nothing reads it here.
    if (c.startsWith("managed")) env.COGNIRUNNER_MANAGED_OPENROUTER_KEY = "sk-or-v1-000000000000000000000000";
    else delete env.COGNIRUNNER_MANAGED_OPENROUTER_KEY;
    const r = spawnSync(process.execPath, [
      "--import", path.join(here, "../lib/register-mocks-index.mjs"),
      path.join(here, "agent-capability-seams.test.mjs"),
    ], { encoding: "utf8", env });
    process.stdout.write((r.stdout || "").split("\n").filter((l) => /passed|FAIL/.test(l)).join("\n") + "\n");
    if (r.status !== 0) { process.stderr.write(r.stderr || ""); fail++; console.log(`FAIL: the F-811 case ${c} failed`); }
  }
}

/* The OFF world, as a child process: see the header — the provider memo cannot be
 * flipped once index.js has read it. */
if (!CAP_OFF && fail === 0) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const c = spawnSync(process.execPath, [
    "--import", path.join(here, "../lib/register-mocks-index.mjs"),
    path.join(here, "agent-capability-seams.test.mjs"),
  ], { encoding: "utf8", env: { ...process.env, CR_CAP_SEAMS_OFF: "1" } });
  process.stdout.write((c.stdout || "").split("\n").filter((l) => /passed|FAIL/.test(l)).join("\n") + "\n");
  if (c.status !== 0) { process.stderr.write(c.stderr || ""); fail++; console.log("FAIL: the capability-OFF world failed"); }
}

process.exit(fail ? 1 : 0);
