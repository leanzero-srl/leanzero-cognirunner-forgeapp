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

/* ═════ F-837 — A VIEWER-FLOOR READ DOOR MUST NOT PERFORM THE LEGACY-SLOT WRITE ═════
 *
 * `getOpenAIModel()` carries `migrate: true`: the one-time copy of the pre-per-provider
 * global slot `COGNIRUNNER_OPENAI_MODEL` into the ACTIVE provider's own slot, on the
 * first read that is about to dispatch (eaf7d405, the same shape as getOpenAIKey's key
 * migration). Two VIEWER-floor READ doors reached it for a display value — the admin
 * panel's agent-model door (F-835) and `getOpenAIModelFromKVS`'s factory arm — so a
 * viewer opening the Settings tab could perform a KVS write. A permission floor that
 * says "read" while the door writes is not a floor anyone can audit.
 *
 * The property has two halves and BOTH are asserted, because deleting the migration
 * would pass the first one alone and would silently orphan every legacy instance:
 *   1. a VIEWER read, with the legacy slot present and a BYOK key in place so the
 *      migration WOULD fire, writes NOTHING — `storage.set` is called zero times;
 *   2. the dispatch reader `getOpenAIModel()` STILL migrates, exactly once, and the
 *      second call writes nothing more.
 *
 * A CHILD PROCESS, for the same reason the F-811 cases are: `getOpenAIModel` memoises
 * for 30 s and the provider memo cannot be flipped once index.js has read it, so the
 * "migration has not happened yet" state exists only on a cold container.
 */
const runF837 = async () => {
  const VIEWER = "acct-viewer";
  await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });
  await storage.set("COGNIRUNNER_SEAT_SNAPSHOT", { seats: 10, at: new Date().toISOString() });
  await storage.set("app_admins", [
    { accountId: ADMIN, role: "admin", scope: "all" },
    { accountId: VIEWER, role: "viewer", scope: "all" },
  ]);
  await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
  // The migration's own precondition: it only fires where a BYOK key exists.
  await storage.set("COGNIRUNNER_KEY_openai", "sk-legacy-instance");
  await storage.set("COGNIRUNNER_OPENAI_MODEL", "gpt-5.4-legacy");

  const idx = await import("../../src/index.js");
  const { handler: h, getOpenAIModel } = idx;

  // Count every write THROUGH THE MOCK, which is the same object src/index.js holds.
  const realSet = storage.set.bind(storage);
  let writes = [];
  storage.set = async (...a) => { writes.push(a[0]); return realSet(...a); };

  const asViewer = (fn, payload = {}) => h({ call: { functionKey: fn, payload }, context: {} }, { principal: { accountId: VIEWER } });

  // ORDER MATTERS, and it is the order of the defect: the agent-model door goes FIRST, on
  // a container whose 30 s model memo is still COLD and whose BYOK key is in place. That
  // is the exact state in which the old door's `getOpenAIModel()` arm performed the
  // legacy write, and it is the only state in which it can be caught — once anything has
  // warmed the memo, the migrating reader never reaches storage again.
  writes = [];
  const ag = await asViewer("getAgentModel", { provider: "openai" });
  ok(ag && ag.success === true, "F-837: the viewer's getAgentModel read succeeds");
  eq(writes.length, 0, `F-837: …and writes NOTHING (wrote ${JSON.stringify(writes)})`);
  // F-848 — THE WINDOW IS CLOSED. The read door now passes `migrate:true` with a null
  // `onMigrate`, the mode the shared chain explicitly supports (read and honour, write
  // nothing), so on a pre-per-provider instance that is cold and has not dispatched since
  // the upgrade the panel names the LEGACY model — the one the very next transition would
  // run — instead of the provider default. Status and first dispatch no longer disagree.
  eq(String(ag.model), "gpt-5.4-legacy", "F-848: …naming the LEGACY model the runtime would resolve, not the provider default");

  writes = [];
  const kvs1 = await asViewer("getOpenAIModelFromKVS", { provider: "openai" });
  ok(kvs1 && kvs1.success === true, `F-837: the viewer's getOpenAIModelFromKVS read succeeds (${JSON.stringify(kvs1).slice(0, 120)})`);
  eq(writes.length, 0, `F-837: …and writes NOTHING (wrote ${JSON.stringify(writes)})`);
  // What this door REPORTS is unchanged by the cut: with a BYOK key and no per-provider
  // slot it has always answered `null` ("nothing saved"), because the legacy-honouring
  // arm is the `!byokKey` factory branch. Asserted so the cut is pinned to the WRITE and
  // cannot be read as a change to the answer.
  eq(kvs1.model, null, "F-837: …and its answer is unchanged — no saved per-provider model");
  eq(kvs1.isByok, true, "F-837: …still reported as BYOK");

  ok((await storage.get("COGNIRUNNER_MODEL_openai")) === null || (await storage.get("COGNIRUNNER_MODEL_openai")) === undefined,
    "F-837: after BOTH viewer reads the per-provider model slot is still unwritten");

  // THE MIGRATION IS NOT GONE — deleting it would pass every assertion above and would
  // silently orphan every pre-per-provider instance. The dispatch reader still performs
  // it, exactly once.
  writes = [];
  const m1 = await getOpenAIModel();
  eq(String(m1), "gpt-5.4-legacy", "F-837: getOpenAIModel resolves the legacy model");
  eq(writes.filter((k) => k === "COGNIRUNNER_MODEL_openai").length, 1,
    `F-837: …and MIGRATES it into the per-provider slot exactly once (wrote ${JSON.stringify(writes)})`);
  eq(String(await storage.get("COGNIRUNNER_MODEL_openai")), "gpt-5.4-legacy", "F-837: …the slot now holds it");
  writes = [];
  await getOpenAIModel();
  eq(writes.length, 0, "F-837: …and a second read migrates nothing more");

  // THE FACTORY ARM, the other door named in the finding: keyless, provider active. It
  // now asks the chain directly instead of the migrating reader; same answer, no write.
  // (It could not have migrated from here in any case — the chain only migrates where a
  // BYOK key exists and this arm is the `!byokKey` branch. That is a coincidence of two
  // guards, not a design, which is why the option is now explicit at the call site.)
  await storage.delete("COGNIRUNNER_KEY_openai");
  writes = [];
  const kvs2 = await asViewer("getOpenAIModelFromKVS", { provider: "openai" });
  ok(kvs2 && kvs2.success === true && kvs2.isByok === false, "F-837: the keyless factory arm answers");
  eq(writes.length, 0, `F-837: …and writes NOTHING (wrote ${JSON.stringify(writes)})`);
  eq(String(kvs2.model), "gpt-5.4-legacy", "F-837: …naming the model the instance actually runs");

  storage.set = realSet;
};

/* ═════ F-837 SOURCE SHAPE — `migrate: true` has EXACTLY ONE call site ═════
 *
 * The behavioural half above proves today's doors are clean. This is what stops the next
 * read door reaching the migrating reader: `migrate` is an option on a shared chain, so
 * the write is invisible at the call site — `await getOpenAIModel()` reads like a getter.
 */
const f837Shape = () => {
  const idxSrc3 = readFileSync(path.join(fileURLToPath(new URL("../../src/index.js", import.meta.url))), "utf8");
  const code = idxSrc3.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  // F-848 — the countable property is no longer `migrate:true` (READ doors carry it too,
  // so they honour the legacy slot); it is the WRITER. Exactly one call site may leave
  // `onMigrate` at its default, and every other must pin it to null in so many words.
  const sites = code.split("\n").filter((l) => /migrate:\s*true/.test(l) && !/onMigrate:\s*null/.test(l));
  eq(sites.length, 1, `F-848.SHAPE: exactly ONE migrating call site WITH A WRITER in src/index.js (got ${sites.length}: ${sites.map((l) => l.trim()).join(" | ")})`);
  // …and it is inside getOpenAIModel, the ACTIVE-provider dispatch reader — not a
  // resolver door. NOTE, recorded honestly: that site is NOT admin-gated, because the
  // migration is deliberately a first-DISPATCH migration (see its docblock); the floor
  // this finding is about is that no VIEWER-floor RESOLVER reaches it.
  const mod = code.match(/const getOpenAIModel = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!mod && /migrate: true/.test(mod[0]), "F-837.SHAPE: …and it lives in getOpenAIModel, the active-provider dispatch reader");
  ok(!/resolver\.define[\s\S]{0,4000}?migrate:\s*true(?![^\n]*onMigrate:\s*null)/.test(code.slice(code.indexOf('resolver.define("getAgentModel"'), code.indexOf('resolver.define("getAgentModel"') + 1400)),
    "F-837.SHAPE: …and no WRITING migration in the agent-model door");
  // The two repaired read doors name their intent EXPLICITLY rather than relying on the
  // chain's default, so a reader of either one can see the door does not write.
  for (const [door, span] of [['resolver.define("getAgentModel"', 1600], ['resolver.define("getOpenAIModelFromKVS"', 3000]]) {
    const i = code.indexOf(door);
    ok(i > 0, `F-837.SHAPE: found ${door}`);
    const body = code.slice(i, i + span);
    ok(!/getOpenAIModel\(\)/.test(body), `F-837.SHAPE: ${door} no longer rides the migrating reader`);
  }
  ok(/migrate: true, onMigrate: null/.test(code.slice(code.indexOf('resolver.define("getOpenAIModelFromKVS"'), code.indexOf('resolver.define("getOpenAIModelFromKVS"') + 3000)),
    "F-848.SHAPE: getOpenAIModelFromKVS's factory arm honours the legacy slot and pins onMigrate:null in so many words");
  const gam2 = code.match(/export const getAgentModelFor = async \(provider\) => [\s\S]*?;\n/);
  ok(!!gam2 && /migrate: true, onMigrate: null/.test(gam2[0]),
    "F-848.SHAPE: getAgentModelFor — which the panel door now rides — reads the legacy slot and pins onMigrate:null");
};

if (process.env.CR_F837 === "1") {
  f837Shape();
  await runF837();
  console.log(`agent capability F-837: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

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
  /* F-819 — THE POLICY IS PER CALL SITE, NOT PER FILE. `restGateContext` in
   * src/rules-api.js read the facts MEMOISED while being the REST skin over the very
   * save doors this policy had just made fresh, so the assertion below reads EVERY
   * source that calls the fact reader. A new file that calls it inherits the rule the
   * moment its name goes in this list. */
  const SOURCES = ["src/index.js", "src/rules-api.js", "src/virtual-admin.js"];
  const srcOf = (rel) => readFileSync(path.join(fileURLToPath(new URL(`../../${rel}`, import.meta.url))), "utf8")
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const callSites = (code) => code.split("\n").filter((l) => /agentGateFacts\(/.test(l)
    && !/const agentGateFacts/.test(l) && !/^\s*agentGateFacts,\s*$/.test(l) && !/^\s*const \{ agentGateFacts \}/.test(l));
  const idxCode = srcOf("src/index.js");
  const idxSites = callSites(idxCode);
  ok(idxSites.length >= 6, `F-811.SHAPE: found ${idxSites.length} agentGateFacts call sites in src/index.js`);
  const allCached = [];
  for (const rel of SOURCES) {
    const sites = callSites(srcOf(rel));
    ok(sites.length >= 1, `F-819.SHAPE: ${rel} calls agentGateFacts (found ${sites.length})`);
    for (const l of sites.filter((l) => !/fresh:\s*true/.test(l))) allCached.push(`${rel}: ${l.trim()}`);
  }
  ok(allCached.length === 1,
    `F-819.SHAPE: across ${SOURCES.join(" + ")}, exactly ONE call site is memoised (got ${allCached.length}: ${allCached.join(" | ")})`);
  ok(allCached.every((l) => /F-811 HOT PATH: memoised on purpose/.test(l)),
    `F-811.SHAPE: …and it is the RUN-TIME one, marked in place (got ${allCached.join(" | ")})`);
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

/* ═════ F-835 — THE PANEL'S AGENT-MODEL DOOR IS THE GATE'S READER, FOR EVERY PROVIDER ═════
 *
 * F-811 put the two CAPABILITY arms back together. The admin panel's Settings tab then
 * turned out to hold a THIRD copy of the same chain: the `getAgentModel` resolver
 * (OpenAIConfig.jsx calls it with `provider: <the row being browsed>`) read the agent
 * slot and, for anything that was not the ACTIVE provider, answered
 * `PROVIDERS[target].defaultModel` WITHOUT EVER READING THAT PROVIDER'S ORDINARY MODEL
 * SLOT — while `agentGateFacts → getAgentModelFor(target)` read it. Same instance, same
 * provider, two model ids: the panel said Haiku / needs-frontier-model beside a
 * capability card that said enabled.
 *
 * The property is PARITY, asserted across the cross-product of provider × slot state
 * rather than on one convenient row, because the old door was RIGHT for the active
 * provider with an agent slot filled — the only combination anyone tests by hand.
 *
 * These run in the MAIN world (the active provider here is whatever the world seeded);
 * the door takes its provider from the payload and the chain reads no provider at all,
 * so nothing here depends on the 30 s memo.
 */
{
  const { handler: idxHandler, getAgentModelFor } = await import("../../src/index.js");
  const { PROVIDER_IDS } = await import("../../src/shared/provider-slots.js");
  const door = async (provider) => idxHandler(
    { call: { functionKey: "getAgentModel", payload: { provider } }, context: {} },
    { principal: { accountId: ADMIN } },
  );
  const slotStates = [
    ["both slots empty", null, null],
    ["ONLY the ordinary model slot — the state the old door could not see", null, "claude-sonnet-5"],
    ["only the agent slot", "claude-opus-5", null],
    ["both, agent wins", "claude-opus-5", "claude-sonnet-5"],
    ["a vendor-prefixed id in the ordinary slot", null, "anthropic/claude-opus-5"],
    ["a junk id in the agent slot", "totally/bogus-9", null],
  ];
  const { providerModelSlot, providerAgentModelSlot: agentSlotKey } = await import("../../src/shared/provider-slots.js");
  for (const [label, agentVal, modelVal] of slotStates) {
    for (const p of PROVIDER_IDS) {
      if (agentVal) await storage.set(agentSlotKey(p), agentVal); else await storage.delete(agentSlotKey(p));
      if (modelVal) await storage.set(providerModelSlot(p), modelVal); else await storage.delete(providerModelSlot(p));
      const r = await door(p);
      const gate = await getAgentModelFor(p);
      ok(r && r.success === true, `F-835.PARITY (${label}) ${p}: the door answers`);
      eq(String(r && r.model), String(gate), `F-835.PARITY (${label}) ${p}: the door's model IS the gate's model`);
    }
  }
  // …and the display flags the door legitimately adds are still there.
  for (const p of PROVIDER_IDS) {
    await storage.delete(agentSlotKey(p)); await storage.delete(providerModelSlot(p));
    const r = await door(p);
    eq(r.frontierOnly, p === "atlassian" || p === "managed", `F-835.FLAGS ${p}: frontierOnly is unchanged`);
    ok(typeof r.edition === "string", `F-835.FLAGS ${p}: the edition still rides along`);
  }
  // Restore the world's own seeding — later blocks read these.
  await storage.set("COGNIRUNNER_AGENT_MODEL_atlassian", "claude-sonnet-5");
}

/* ═════ F-835/F-837 SOURCE SHAPE — the door DERIVES, it does not re-resolve ═════ */
{
  const idxSrc2 = readFileSync(path.join(fileURLToPath(new URL("../../src/index.js", import.meta.url))), "utf8");
  const i = idxSrc2.indexOf('resolver.define("getAgentModel"');
  ok(i > 0, "F-835.SHAPE: found the getAgentModel resolver");
  const body = idxSrc2.slice(i, idxSrc2.indexOf("\n});", i));
  // F-991 — the door now serves TWO slots (agent, coder) through one reader, so it asks
  // `readModelForSlot` rather than naming a binding itself. The PROPERTY is unchanged and
  // is asserted one hop further in: that reader dispatches to the SAME two bindings the
  // gate rides, and to nothing else — in particular never to `getOpenAIModel()`, the
  // ordinary rules model, which is the re-resolution F-835 was cut to end.
  ok(/readModelForSlot\(payload && payload\.slot, provider\)/.test(body),
    "F-835.SHAPE: the door asks readModelForSlot — it does not re-resolve a model itself");
  const slotReader = idxSrc2.match(/const readModelForSlot = [\s\S]*?;\n/);
  ok(!!slotReader && /getCoderModelFor : getAgentModelFor/.test(slotReader[0]),
    "F-835.SHAPE: …and readModelForSlot dispatches to getCoderModelFor/getAgentModelFor — the same bindings the gate rides");
  ok(!!slotReader && !/getOpenAIModel\(/.test(slotReader[0]),
    "F-991.SHAPE: …and never to the ORDINARY rules model");
  ok(!/getOpenAIModel\(\)/.test(body),
    "F-835.SHAPE: …and no longer falls through the ACTIVE-provider reader (that arm also carried migrate:true — F-837)");
  ok(!/PROVIDERS\[provider\]/.test(body),
    "F-835.SHAPE: …and no longer answers the default table directly, skipping the provider's model slot");
  ok(!/clampManagedModel\(/.test(body),
    "F-835.SHAPE: …and re-applies no policy of its own — the clamp and the Forge LLM belt are the chain's (F-826)");
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

/* F-837 — a COLD child: the legacy migration exists only before getOpenAIModel has run
 * once, and its 30 s memo cannot be cleared from outside. */
if (!CAP_OFF && fail === 0) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const r = spawnSync(process.execPath, [
    "--import", path.join(here, "../lib/register-mocks-index.mjs"),
    path.join(here, "agent-capability-seams.test.mjs"),
  ], { encoding: "utf8", env: { ...process.env, CR_F837: "1" } });
  process.stdout.write((r.stdout || "").split("\n").filter((l) => /passed|FAIL/.test(l)).join("\n") + "\n");
  if (r.status !== 0) { process.stderr.write(r.stderr || ""); fail++; console.log("FAIL: the F-837 case failed"); }
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
